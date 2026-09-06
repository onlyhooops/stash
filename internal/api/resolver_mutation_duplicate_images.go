package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/stashapp/stash/internal/manager"
	"github.com/stashapp/stash/pkg/file"
	"github.com/stashapp/stash/pkg/image"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/sliceutil/stringslice"
)

// DestroyDuplicateImageFiles deletes the provided duplicate image files. Where
// an image is left without any files, the image record (and its generated
// files, if they are not shared with any remaining file) is deleted as well.
//
// After deletion, the image's folder gallery memberships are repaired (an
// image is removed from a folder gallery when it no longer has any file in
// that folder) and folders that become empty are deleted, together with their
// database records and any empty folder galleries.
func (r *mutationResolver) DestroyDuplicateImageFiles(ctx context.Context, fileIds []string) (bool, error) {
	fileIDs, err := stringslice.StringSliceToIntSlice(fileIds)
	if err != nil {
		return false, fmt.Errorf("converting ids: %w", err)
	}

	trashPath := manager.GetInstance().Config.GetDeleteTrashPath()

	fileDeleter := file.NewDeleterWithTrash(trashPath)
	imageFileDeleter := &image.FileDeleter{
		Deleter: fileDeleter,
		Paths:   manager.GetInstance().Paths,
	}

	affectedFolders := map[models.FolderID]bool{}
	touchedImages := map[int]bool{}

	if err := r.withTxn(ctx, func(ctx context.Context) error {
		qb := r.repository.File
		imageQb := r.repository.Image

		for _, fileIDInt := range fileIDs {
			fileID := models.FileID(fileIDInt)

			found, err := qb.Find(ctx, fileID)
			if err != nil {
				return err
			}
			if len(found) == 0 {
				continue
			}

			f := found[0]
			base := f.Base()

			// don't touch files inside zip archives
			if base.ZipFileID != nil {
				continue
			}

			images, err := imageQb.FindByFileID(ctx, fileID)
			if err != nil {
				return err
			}

			fileRemoved := false
			for _, img := range images {
				touchedImages[img.ID] = true

				if err := img.LoadFiles(ctx, imageQb); err != nil {
					return err
				}

				if len(img.Files.List()) > 1 {
					// the image retains other files - just detach this one.
					// Removing the primary file is handled by the store, which
					// reassigns the primary file.
					if err := imageQb.RemoveFileID(ctx, img.ID, fileID); err != nil {
						return err
					}
				} else {
					// deleting the only file of the image - destroy the image
					// record as well. Only delete its generated files if no
					// other file shares the checksum, since the generated
					// files are keyed by checksum.
					deleteGenerated := true
					if md5 := base.Fingerprints.GetString(models.FingerprintTypeMD5); md5 != "" {
						matches, err := qb.FindByFingerprint(ctx, models.Fingerprint{
							Type:        models.FingerprintTypeMD5,
							Fingerprint: md5,
						})
						if err != nil {
							return err
						}

						for _, m := range matches {
							if m.Base().ID != fileID {
								deleteGenerated = false
								break
							}
						}
					}

					const destroyFileEntry = false
					if err := r.imageService.Destroy(ctx, img, imageFileDeleter, deleteGenerated, true, destroyFileEntry); err != nil {
						return err
					}

					fileRemoved = true
				}
			}

			if !fileRemoved {
				// the file was detached from its image(s) - delete the file
				// itself if it is no longer referenced by any image
				remaining, err := imageQb.FindByFileID(ctx, fileID)
				if err != nil {
					return err
				}

				if len(remaining) == 0 {
					const deleteFile = true
					if err := file.Destroy(ctx, qb, f, fileDeleter, deleteFile); err != nil {
						return err
					}

					fileRemoved = true
				}
			}

			if fileRemoved && base.ParentFolderID != 0 {
				affectedFolders[base.ParentFolderID] = true
			}
		}

		return r.repairGalleryMemberships(ctx, touchedImages)
	}); err != nil {
		fileDeleter.Rollback()
		return false, err
	}

	fileDeleter.Commit()

	r.deleteEmptyFolders(ctx, affectedFolders)

	return true, nil
}

// repairGalleryMemberships removes images from folder galleries when the image
// no longer has any file located in the gallery's folder. This prevents
// gallery pages from showing images whose duplicate files in that folder have
// been deleted while the image itself still exists (with files elsewhere).
func (r *mutationResolver) repairGalleryMemberships(ctx context.Context, imageIDs map[int]bool) error {
	imageQb := r.repository.Image

	for imageID := range imageIDs {
		img, err := imageQb.Find(ctx, imageID)
		if err != nil {
			return err
		}
		if img == nil {
			// image was destroyed as part of the deletion
			continue
		}

		if err := img.LoadFiles(ctx, imageQb); err != nil {
			return err
		}
		if err := img.LoadGalleryIDs(ctx, imageQb); err != nil {
			return err
		}

		for _, galleryID := range img.GalleryIDs.List() {
			gallery, err := r.repository.Gallery.Find(ctx, galleryID)
			if err != nil {
				return err
			}
			if gallery == nil || gallery.FolderID == nil {
				continue
			}

			hasFileInFolder := false
			for _, file := range img.Files.List() {
				if file.Base().ParentFolderID == *gallery.FolderID {
					hasFileInFolder = true
					break
				}
			}

			if !hasFileInFolder {
				if err := r.repository.Gallery.RemoveImages(ctx, galleryID, imageID); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// deleteEmptyFolders deletes folders that became empty, together with their
// database records and any empty folder galleries. Only folders that are not
// library roots and contain no files on disk are deleted. Any errors are
// logged and ignored, so that partially-deleted state does not prevent other
// folders from being processed.
func (r *mutationResolver) deleteEmptyFolders(ctx context.Context, folderIDs map[models.FolderID]bool) {
	stashPaths := manager.GetInstance().Config.GetStashPaths()

	for folderID := range folderIDs {
		folder, err := r.repository.Folder.Find(ctx, folderID)
		if err != nil || folder == nil {
			continue
		}

		// skip folders inside zip archives and library roots
		if folder.ZipFileID != nil {
			continue
		}

		path := filepath.Clean(folder.Path)
		if path == "" {
			continue
		}

		isLibraryRoot := false
		for _, stashPath := range stashPaths {
			if filepath.Clean(stashPath.Path) == path {
				isLibraryRoot = true
				break
			}
		}
		if isLibraryRoot {
			continue
		}

		entries, err := os.ReadDir(path)
		if err != nil || len(entries) > 0 {
			// folder doesn't exist or is not empty - nothing to do
			continue
		}

		if err := r.withTxn(ctx, func(ctx context.Context) error {
			// remove any folder galleries
			galleries, err := r.repository.Gallery.FindByFolderID(ctx, folderID)
			if err != nil {
				return err
			}

			for _, g := range galleries {
				if err := r.repository.Gallery.Destroy(ctx, g.ID); err != nil {
					return err
				}
			}

			// don't delete the folder if it still has child folders
			children, err := r.repository.Folder.FindByParentFolderID(ctx, folderID)
			if err != nil {
				return err
			}
			if len(children) > 0 {
				return errors.New("folder has child folders")
			}

			return r.repository.Folder.Destroy(ctx, folderID)
		}); err != nil {
			logger.Warnf("Could not delete empty folder %s: %v", folder.Path, err)
			continue
		}

		if err := os.Remove(path); err != nil {
			logger.Warnf("Could not remove empty folder %s: %v", folder.Path, err)
		}
	}
}
