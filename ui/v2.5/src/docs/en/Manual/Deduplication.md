# Dupe checker

[The dupe checker](/sceneDuplicateChecker) searches your collection for scenes that are perceptually similar. This means that the files don't need to be identical, and will be identified even with different bitrates, resolutions, and intros/outros.

To achieve this stash needs to generate what's called a phash, or perceptual hash. Similar to sprite generation stash will generate a set of 25 images from fixed points in the scene. These images will be stitched together, and then hashed using the phash algorithm. The phash can then be used to find scenes that are the same or similar to others in the database. Phash generation can be run during scan, or as a separate task. 

> **⚠️ Note:** Generation can take a while due to the work involved with extracting screenshots.

The dupe checker can be run with four different levels of accuracy. `Exact` looks for scenes that have exactly the same phash. This is a fast and accurate operation that should not yield any false positives except in very rare cases. The other accuracy levels look for duplicate files within a set distance of each other. This means the scenes don't have exactly the same phash, but are very similar. `High` and `Medium` should still yield very good results with few or no false positives. `Low` is likely to produce some false positives, but might still be useful for finding dupes.

> **⚠️ Note:** To generate a pHash Stash requires an uncorrupted file. If any errors are encountered during sprite generation the pHash will not be generated. This is to prevent false positives.

## Selecting duplicates

The `Select Options…` dropdown provides shortcuts for bulk-selecting files across every duplicate group on the current page. Each option selects every file in a group *except* the one to keep, so the selection can be reviewed and then deleted:

- **Largest file** and **highest resolution** keep the largest file, or the file with the highest resolution.
- **Oldest / youngest** keep the file with the oldest or youngest modification time.
- **Preferred codec** keeps the file matching the codec chosen in the `Preferred Video Codec` dropdown, which lists the codecs detected among the current duplicate results. Groups that contain no file with the preferred codec are left untouched, so nothing is selected when there is no matching file to keep.

The `Only select if all codecs match in the duplicate group` checkbox is a safety option for the size, resolution and age selections: when enabled, groups whose files use different codecs are skipped, so you don't accidentally select a file that was encoded with a different codec. It does not apply to the preferred-codec selection, which is codec-aware by design.

## Images

Duplicate checking is also available for images, via the [image duplicate checker](/imageDuplicateChecker). As with scenes, stash generates a phash for each image file, which can be run during scan ("Generate image phashes during scan") or as a separate task, and the same four accuracy levels (`Exact`, `High`, `Medium`, `Low`) are used to group perceptually similar images.

Because images don't have a duration, there is no duration-based matching. The `Select Options…` shortcuts work in the same way as for scenes, with the exception of the codec-based options, which only apply to video files.

### Byte-identical duplicates

The `Duplicate type` selector switches between two detection modes:

- **Perceptual (phash)** – the behaviour described above: groups images whose perceptual hashes are identical or similar.
- **Byte-identical (md5)** – finds image files whose contents are byte-for-byte identical (same md5 fingerprint), including multiple identical copies that stash attached to the same image when scanning duplicate paths. Files inside zip archives are not considered.

In the byte-identical mode, each duplicated file is listed with the image it belongs to, so a single image with several identical copies appears multiple times. Use the checkboxes or `Select Options…` (which keeps the oldest or youngest copy of each duplicated image, or selects every file in a chosen `Preferred folder`) to select the extra copies and delete them.

Deleting removes the files from disk and frees up space, and automatically keeps the stash database consistent: images that are left without any files are removed together with their generated thumbnails when these are not shared with a remaining copy; images are removed from folder galleries when they no longer have a file in that folder; and folders that become completely empty are removed too (library roots and non-empty folders are never touched).