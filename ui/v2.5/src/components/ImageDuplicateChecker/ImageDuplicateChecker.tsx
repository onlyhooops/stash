import React, { useMemo, useState } from "react";
import {
  Button,
  ButtonGroup,
  Card,
  Col,
  Dropdown,
  Form,
  OverlayTrigger,
  Row,
  Table,
  Tooltip,
} from "react-bootstrap";
import { Link, useHistory } from "react-router-dom";
import { FormattedMessage, useIntl } from "react-intl";

import * as GQL from "src/core/generated-graphql";
import { LoadingIndicator } from "../Shared/LoadingIndicator";
import { ErrorMessage } from "../Shared/ErrorMessage";
import { HoverPopover } from "../Shared/HoverPopover";
import { Icon } from "../Shared/Icon";
import { GalleryLink, TagLink } from "../Shared/TagLink";
import { SweatDrops } from "../Shared/SweatDrops";
import { Pagination } from "src/components/List/Pagination";
import TextUtils from "src/utils/text";
import { DeleteImagesDialog } from "../Images/DeleteImagesDialog";
import { EditImagesDialog } from "../Images/EditImagesDialog";
import { PerformerPopoverButton } from "../Shared/PerformerPopoverButton";
import {
  faBox,
  faExclamationTriangle,
  faFileAlt,
  faImages,
  faPencilAlt,
  faTag,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FileSize } from "../Shared/FileSize";
import { DuplicateType, DuplicateTypeSelector } from "./DuplicateTypeSelector";
import { ImageDuplicateCheckerBytes } from "./ImageDuplicateCheckerBytes";

const CLASSNAME = "duplicate-checker";

function getGroupTotalSize(group: GQL.SlimImageDataFragment[]) {
  // Sum all file sizes across all images in the group
  return group.reduce((groupTotal, image) => {
    const imageTotal = image.visual_files.reduce(
      (fileTotal, file) => fileTotal + file.size,
      0
    );
    return groupTotal + imageTotal;
  }, 0);
}

export const ImageDuplicateChecker: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();
  const query = new URLSearchParams(history.location.search);
  const currentPage = Number.parseInt(query.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(query.get("size") ?? "20", 10);
  const hashDistance = Number.parseInt(query.get("distance") ?? "0", 10);
  const dupeType: DuplicateType =
    query.get("mode") === "identical" ? "identical" : "perceptual";

  const selectDupeType = (type: DuplicateType) => {
    const newQuery = new URLSearchParams(history.location.search);
    if (type === "perceptual") {
      newQuery.delete("mode");
    } else {
      newQuery.set("mode", type);
    }
    newQuery.delete("page");
    history.replace({ search: newQuery.toString() });
  };

  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [deletingImages, setDeletingImages] = useState(false);
  const [editingImages, setEditingImages] = useState(false);
  const [checkedImages, setCheckedImages] = useState<Record<string, boolean>>(
    {}
  );

  const { data, loading, refetch } = GQL.useFindDuplicateImagesQuery({
    fetchPolicy: "no-cache",
    skip: dupeType !== "perceptual",
    variables: {
      distance: hashDistance,
    },
  });

  const images = useMemo(() => {
    const groups = data?.findDuplicateImages ?? [];
    // Sort by total file size descending (largest groups first)
    return [...groups].sort((a, b) => {
      return getGroupTotalSize(b) - getGroupTotalSize(a);
    });
  }, [data?.findDuplicateImages]);

  const { data: missingPhash } = GQL.useFindImagesQuery({
    skip: dupeType !== "perceptual",
    variables: {
      filter: {
        per_page: 0,
      },
      image_filter: {
        is_missing: "phash",
        file_count: {
          modifier: GQL.CriterionModifier.GreaterThan,
          value: 0,
        },
      },
    },
  });

  const [selectedImages, setSelectedImages] = useState<
    GQL.SlimImageDataFragment[] | null
  >(null);

  const pageOptions = useMemo(() => {
    const pageSizes = [
      10, 20, 30, 40, 50, 100, 150, 200, 250, 500, 750, 1000, 1250, 1500,
    ];

    const filteredSizes = pageSizes.filter((s, i) => {
      return images.length > s || i === 0 || images.length > pageSizes[i - 1];
    });

    return filteredSizes.map((size) => {
      return (
        <option key={size} value={size}>
          {size}
        </option>
      );
    });
  }, [images.length]);

  if (dupeType === "identical") {
    return (
      <Card id="image-duplicate-checker" className="col col-xl-12 mx-auto">
        <div className={CLASSNAME}>
          <DuplicateTypeSelector value={dupeType} onChange={selectDupeType} />
          <Form.Text className="mb-3">
            <FormattedMessage id="image_dupe_check.identical_description" />
          </Form.Text>
          <ImageDuplicateCheckerBytes />
        </div>
      </Card>
    );
  }

  if (loading) return <LoadingIndicator />;
  if (!data) return <ErrorMessage error="Error searching for duplicates." />;

  const filteredImages = images.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const checkCount = Object.keys(checkedImages).filter(
    (id) => checkedImages[id]
  ).length;

  const setQuery = (q: Record<string, string | number | undefined>) => {
    const newQuery = new URLSearchParams(query);
    for (const [key, value] of Object.entries(q)) {
      if (value === undefined || value === "") {
        newQuery.delete(key);
      } else {
        newQuery.set(key, String(value));
      }
    }
    history.replace({ search: newQuery.toString() });
  };

  const resetCheckboxSelection = () => {
    const updatedImages: Record<string, boolean> = {};
    images.flat().forEach((image) => {
      updatedImages[image.id] = false;
    });
    setCheckedImages(updatedImages);
  };

  function onDeleteDialogClosed(deleted: boolean) {
    if (deleted) {
      resetCheckboxSelection();
      refetch();
    }
    setDeletingImages(false);
    setSelectedImages(null);
  }

  const findLargestImage = (group: GQL.SlimImageDataFragment[]) => {
    // Get maximum file size of an image
    const totalSize = (image: GQL.SlimImageDataFragment) => {
      return image.visual_files.reduce(
        (prev: number, f) => Math.max(prev, f.size),
        0
      );
    };
    // Find image object with maximum total size
    return group.reduce((largest, image) => {
      const largestSize = totalSize(largest);
      const currentSize = totalSize(image);
      return currentSize > largestSize ? image : largest;
    });
  };

  const findLargestResolutionImage = (group: GQL.SlimImageDataFragment[]) => {
    // Get maximum resolution of an image
    const imageResolution = (image: GQL.SlimImageDataFragment) => {
      return image.visual_files.reduce(
        (prev: number, f) => Math.max(prev, f.height * f.width),
        0
      );
    };
    // Find image object with maximum resolution
    return group.reduce((largest, image) => {
      const largestSize = imageResolution(largest);
      const currentSize = imageResolution(image);
      return currentSize > largestSize ? image : largest;
    });
  };

  // Helper to get file date
  const findFirstFileByAge = (
    oldest: boolean,
    compareImages: GQL.SlimImageDataFragment[]
  ) => {
    let selectedFile: GQL.VisualFileDataFragment;
    let oldestTimestamp: Date | undefined;

    // Loop through all files
    for (const file of compareImages.flatMap((image) => image.visual_files)) {
      // Get timestamp
      const timestamp: Date = new Date(file.mod_time);

      // Check if current file is oldest
      if (oldest) {
        if (oldestTimestamp === undefined || timestamp < oldestTimestamp) {
          oldestTimestamp = timestamp;
          selectedFile = file;
        }
      } else {
        if (oldestTimestamp === undefined || timestamp > oldestTimestamp) {
          oldestTimestamp = timestamp;
          selectedFile = file;
        }
      }
    }

    // Find image with oldest file
    return compareImages.find((image) =>
      image.visual_files.some((f) => f.id === selectedFile.id)
    );
  };

  function checkSameResolution(dataGroup: GQL.SlimImageDataFragment[]) {
    const resolutions = dataGroup.map(
      (image) => image.visual_files[0]?.width * image.visual_files[0]?.height
    );
    return new Set(resolutions).size === 1;
  }

  const onSelectLargestClick = () => {
    setSelectedImages([]);
    const checkedArray: Record<string, boolean> = {};

    filteredImages.forEach((group) => {
      // Find largest image in group
      const largest = findLargestImage(group);
      group.forEach((image) => {
        if (image !== largest) {
          checkedArray[image.id] = true;
        }
      });
    });

    setCheckedImages(checkedArray);
  };

  const onSelectLargestResolutionClick = () => {
    setSelectedImages([]);
    const checkedArray: Record<string, boolean> = {};

    filteredImages.forEach((group) => {
      // Don't select images where resolution is identical.
      if (checkSameResolution(group)) {
        return;
      }
      // Find the highest resolution image in group.
      const highest = findLargestResolutionImage(group);
      group.forEach((image) => {
        if (image !== highest) {
          checkedArray[image.id] = true;
        }
      });
    });

    setCheckedImages(checkedArray);
  };

  const onSelectByAge = (oldest: boolean) => {
    setSelectedImages([]);

    const checkedArray: Record<string, boolean> = {};

    filteredImages.forEach((group) => {
      const oldestImage = findFirstFileByAge(oldest, group);
      group.forEach((image) => {
        if (image !== oldestImage) {
          checkedArray[image.id] = true;
        }
      });
    });

    setCheckedImages(checkedArray);
  };

  const handleCheck = (checked: boolean, imageID: string) => {
    setCheckedImages({ ...checkedImages, [imageID]: checked });
  };

  const handleDeleteChecked = () => {
    setSelectedImages(images.flat().filter((image) => checkedImages[image.id]));
    setDeletingImages(true);
  };

  const handleDeleteImage = (image: GQL.SlimImageDataFragment) => {
    setSelectedImages([image]);
    setDeletingImages(true);
  };

  function onEdit() {
    setSelectedImages(images.flat().filter((image) => checkedImages[image.id]));
    setEditingImages(true);
    resetCheckboxSelection();
  }

  function maybeRenderMissingPhashWarning() {
    const missingPhashes = missingPhash?.findImages.count ?? 0;
    if (missingPhashes > 0) {
      return (
        <p className="lead">
          <Icon icon={faExclamationTriangle} className="text-warning" />
          <FormattedMessage
            id="image_dupe_check.missing_phashes"
            values={{ count: missingPhashes }}
          />
        </p>
      );
    }
  }

  function maybeRenderEdit() {
    if (editingImages && selectedImages) {
      return (
        <EditImagesDialog
          selected={selectedImages}
          onClose={() => setEditingImages(false)}
        />
      );
    }
  }

  function maybeRenderTagPopoverButton(image: GQL.SlimImageDataFragment) {
    if (image.tags.length <= 0) return;

    const popoverContent = image.tags.map((tag) => (
      <TagLink key={tag.id} tag={tag} linkType="image" />
    ));

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button className="minimal">
          <Icon icon={faTag} />
          <span>{image.tags.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderPerformerPopoverButton(image: GQL.SlimImageDataFragment) {
    if (image.performers.length <= 0) return;

    return <PerformerPopoverButton performers={image.performers} />;
  }

  function maybeRenderOCounter(image: GQL.SlimImageDataFragment) {
    if (image.o_counter) {
      return (
        <div>
          <Button className="minimal">
            <span className="fa-icon">
              <SweatDrops />
            </span>
            <span>{image.o_counter}</span>
          </Button>
        </div>
      );
    }
  }

  function maybeRenderGallery(image: GQL.SlimImageDataFragment) {
    if (image.galleries.length <= 0) return;

    const popoverContent = image.galleries.map((gallery) => (
      <GalleryLink key={gallery.id} gallery={gallery} />
    ));

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button className="minimal">
          <Icon icon={faImages} />
          <span>{image.galleries.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderFileCount(image: GQL.SlimImageDataFragment) {
    if (image.visual_files.length <= 1) return;

    const popoverContent = (
      <FormattedMessage
        id="files_amount"
        values={{ value: intl.formatNumber(image.visual_files.length ?? 0) }}
      />
    );

    return (
      <HoverPopover placement="bottom" content={popoverContent}>
        <Button className="minimal">
          <Icon icon={faFileAlt} />
          <span>{image.visual_files.length}</span>
        </Button>
      </HoverPopover>
    );
  }

  function maybeRenderOrganized(image: GQL.SlimImageDataFragment) {
    if (image.organized) {
      return (
        <div>
          <Button className="minimal">
            <Icon icon={faBox} />
          </Button>
        </div>
      );
    }
  }

  function maybeRenderPopoverButtonGroup(image: GQL.SlimImageDataFragment) {
    if (
      image.tags.length > 0 ||
      image.performers.length > 0 ||
      image?.o_counter ||
      image.galleries.length > 0 ||
      image.visual_files.length > 1 ||
      image.organized
    ) {
      return (
        <ButtonGroup className="flex-wrap">
          {maybeRenderTagPopoverButton(image)}
          {maybeRenderPerformerPopoverButton(image)}
          {maybeRenderOCounter(image)}
          {maybeRenderGallery(image)}
          {maybeRenderFileCount(image)}
          {maybeRenderOrganized(image)}
        </ButtonGroup>
      );
    }
  }

  function renderPagination() {
    return (
      <div className="d-flex mt-2 mb-2">
        <h6 className="mr-auto align-self-center">
          <FormattedMessage
            id="dupe_check.found_sets"
            values={{ setCount: images.length }}
          />
        </h6>
        {checkCount > 0 && (
          <ButtonGroup>
            <OverlayTrigger
              overlay={
                <Tooltip id="edit">
                  {intl.formatMessage({ id: "actions.edit" })}
                </Tooltip>
              }
            >
              <Button variant="secondary" onClick={onEdit}>
                <Icon icon={faPencilAlt} />
              </Button>
            </OverlayTrigger>
            <OverlayTrigger
              overlay={
                <Tooltip id="delete">
                  {intl.formatMessage({ id: "actions.delete" })}
                </Tooltip>
              }
            >
              <Button variant="danger" onClick={handleDeleteChecked}>
                <Icon icon={faTrash} />
              </Button>
            </OverlayTrigger>
          </ButtonGroup>
        )}
        <Pagination
          itemsPerPage={pageSize}
          currentPage={currentPage}
          totalItems={images.length}
          metadataByline={[]}
          onChangePage={(newPage) => {
            setQuery({ page: newPage === 1 ? undefined : newPage });
            resetCheckboxSelection();
          }}
        />
        <Form.Control
          as="select"
          className="w-auto ml-2 btn-secondary"
          defaultValue={pageSize}
          value={currentPageSize}
          onChange={(e) => {
            setCurrentPageSize(parseInt(e.target.value, 10));
            setQuery({
              size: e.target.value === "20" ? undefined : e.target.value,
              page: undefined,
            });
            resetCheckboxSelection();
          }}
        >
          {pageOptions}
        </Form.Control>
      </div>
    );
  }

  return (
    <Card id="image-duplicate-checker" className="col col-xl-12 mx-auto">
      <div className={CLASSNAME}>
        <DuplicateTypeSelector value={dupeType} onChange={selectDupeType} />
        {deletingImages && selectedImages && (
          <DeleteImagesDialog
            selected={selectedImages}
            onClose={onDeleteDialogClosed}
          />
        )}
        {maybeRenderEdit()}
        <h4>
          <FormattedMessage id="image_dupe_check.title" />
        </h4>
        <Form>
          <Form.Group>
            <Row noGutters>
              <Form.Label>
                <FormattedMessage id="dupe_check.search_accuracy_label" />
              </Form.Label>
              <Col xs="auto">
                <Form.Control
                  as="select"
                  onChange={(e) =>
                    setQuery({
                      distance:
                        e.currentTarget.value === "0"
                          ? undefined
                          : e.currentTarget.value,
                      page: undefined,
                    })
                  }
                  defaultValue={hashDistance}
                  className="input-control ml-4"
                >
                  <option value={0}>
                    {intl.formatMessage({ id: "dupe_check.options.exact" })}
                  </option>
                  <option value={4}>
                    {intl.formatMessage({ id: "dupe_check.options.high" })}
                  </option>
                  <option value={8}>
                    {intl.formatMessage({ id: "dupe_check.options.medium" })}
                  </option>
                  <option value={10}>
                    {intl.formatMessage({ id: "dupe_check.options.low" })}
                  </option>
                </Form.Control>
              </Col>
            </Row>
            <Form.Text>
              <FormattedMessage id="dupe_check.description" />
            </Form.Text>
          </Form.Group>

          <Form.Group>
            <Row noGutters>
              <Col xs="12">
                <Dropdown className="">
                  <Dropdown.Toggle variant="secondary">
                    <FormattedMessage id="dupe_check.select_options" />
                  </Dropdown.Toggle>
                  <Dropdown.Menu className="bg-secondary text-white">
                    <Dropdown.Item onClick={() => resetCheckboxSelection()}>
                      {intl.formatMessage({ id: "dupe_check.select_none" })}
                    </Dropdown.Item>

                    <Dropdown.Item
                      onClick={() => onSelectLargestResolutionClick()}
                    >
                      {intl.formatMessage({
                        id: "dupe_check.select_all_but_largest_resolution",
                      })}
                    </Dropdown.Item>

                    <Dropdown.Item onClick={() => onSelectLargestClick()}>
                      {intl.formatMessage({
                        id: "dupe_check.select_all_but_largest_file",
                      })}
                    </Dropdown.Item>

                    <Dropdown.Item onClick={() => onSelectByAge(true)}>
                      {intl.formatMessage({
                        id: "dupe_check.select_oldest",
                      })}
                    </Dropdown.Item>

                    <Dropdown.Item onClick={() => onSelectByAge(false)}>
                      {intl.formatMessage({
                        id: "dupe_check.select_youngest",
                      })}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </Col>
            </Row>
          </Form.Group>
        </Form>

        {maybeRenderMissingPhashWarning()}
        {renderPagination()}

        <Table responsive striped className={`${CLASSNAME}-table`}>
          <colgroup>
            <col className={`${CLASSNAME}-checkbox`} />
            <col className={`${CLASSNAME}-sprite`} />
            <col className={`${CLASSNAME}-title`} />
            <col className={`${CLASSNAME}-details`} />
            <col className={`${CLASSNAME}-filesize`} />
            <col className={`${CLASSNAME}-resolution`} />
            <col className={`${CLASSNAME}-operations`} />
          </colgroup>
          <thead>
            <tr>
              <th> </th>
              <th> </th>
              <th>{intl.formatMessage({ id: "details" })}</th>
              <th> </th>
              <th>{intl.formatMessage({ id: "filesize" })}</th>
              <th>{intl.formatMessage({ id: "resolution" })}</th>
              <th>{intl.formatMessage({ id: "actions.delete" })}</th>
            </tr>
          </thead>
          <tbody>
            {filteredImages.map((group, groupIndex) =>
              group.map((image, i) => {
                const file =
                  image.visual_files.length > 0
                    ? image.visual_files[0]
                    : undefined;

                return (
                  <>
                    {i === 0 && groupIndex !== 0 ? (
                      <tr className="separator" />
                    ) : undefined}
                    <tr
                      className={i === 0 ? "duplicate-group" : ""}
                      key={image.id}
                    >
                      <td>
                        <Form.Check
                          checked={checkedImages[image.id]}
                          onChange={(e) =>
                            handleCheck(e.currentTarget.checked, image.id)
                          }
                        />
                      </td>
                      <td>
                        <HoverPopover
                          content={
                            <img
                              src={image.paths.preview ?? ""}
                              alt=""
                              width={400}
                            />
                          }
                          placement="right"
                        >
                          <img
                            src={image.paths.thumbnail ?? ""}
                            alt=""
                            width={100}
                            style={{
                              border: checkedImages[image.id]
                                ? "2px solid red"
                                : "",
                            }}
                          />
                        </HoverPopover>
                      </td>
                      <td className="text-left">
                        <p>
                          <Link
                            to={`/images/${image.id}`}
                            style={{
                              fontWeight: checkedImages[image.id]
                                ? "bold"
                                : "inherit",
                              textDecoration: checkedImages[image.id]
                                ? "line-through 3px"
                                : "inherit",
                              textDecorationColor: checkedImages[image.id]
                                ? "red"
                                : "inherit",
                            }}
                          >
                            {" "}
                            {image.title
                              ? image.title
                              : TextUtils.fileNameFromPath(
                                  file?.path ?? ""
                                )}{" "}
                          </Link>
                        </p>
                        <p className="image-path">{file?.path ?? ""}</p>
                      </td>
                      <td className="image-details">
                        {maybeRenderPopoverButtonGroup(image)}
                      </td>
                      <td>
                        <FileSize size={file?.size ?? 0} />
                      </td>
                      <td>{`${file?.width ?? 0}x${file?.height ?? 0}`}</td>
                      <td>
                        <Button
                          className="edit-button"
                          variant="danger"
                          data-action="delete"
                          onClick={() => handleDeleteImage(image)}
                        >
                          <FormattedMessage id="actions.delete" />
                        </Button>
                      </td>
                    </tr>
                  </>
                );
              })
            )}
          </tbody>
        </Table>
        {images.length === 0 && (
          <h4 className="text-center mt-4">
            <FormattedMessage id="image_dupe_check.no_duplicates" />
          </h4>
        )}
        {renderPagination()}
      </div>
    </Card>
  );
};

export default ImageDuplicateChecker;
