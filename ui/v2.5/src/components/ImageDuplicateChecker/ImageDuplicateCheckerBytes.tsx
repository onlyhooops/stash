import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  ButtonGroup,
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
import { Pagination } from "src/components/List/Pagination";
import TextUtils from "src/utils/text";
import { FileSize } from "../Shared/FileSize";
import { faTrash } from "@fortawesome/free-solid-svg-icons";

const CLASSNAME = "duplicate-checker";

// returns the parent folder path of a file path
function getFolderPath(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return index >= 0 ? filePath.substring(0, index) : filePath;
}

type DuplicateGroup = NonNullable<
  GQL.FindDuplicateImageFilesQuery["findDuplicateImageFiles"]
>[number];

type DuplicateItem = DuplicateGroup[number];

export const ImageDuplicateCheckerBytes: React.FC = () => {
  const intl = useIntl();
  const history = useHistory();
  const query = new URLSearchParams(history.location.search);
  const currentPage = Number.parseInt(query.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(query.get("size") ?? "20", 10);

  const [currentPageSize, setCurrentPageSize] = useState(pageSize);
  const [checkedFiles, setCheckedFiles] = useState<Record<string, boolean>>({});
  const [selectedFolder, setSelectedFolder] = useState("");

  const { data, loading, refetch } = GQL.useFindDuplicateImageFilesQuery({
    fetchPolicy: "no-cache",
  });
  const [destroyDuplicateImageFiles] =
    GQL.useDestroyDuplicateImageFilesMutation();

  const groups = useMemo(
    () => data?.findDuplicateImageFiles ?? [],
    [data?.findDuplicateImageFiles]
  );

  // distinct folders that contain duplicate files in the current results
  const folderOptions = useMemo(() => {
    const folders = new Set<string>();
    for (const group of groups) {
      for (const item of group) {
        folders.add(getFolderPath(item.file.path));
      }
    }
    return Array.from(folders).sort();
  }, [groups]);

  // default the folder selection to the first folder with duplicates
  useEffect(() => {
    if (folderOptions.length > 0 && !folderOptions.includes(selectedFolder)) {
      setSelectedFolder(folderOptions[0]);
    }
  }, [folderOptions, selectedFolder]);

  const pageOptions = useMemo(() => {
    const pageSizes = [
      10, 20, 30, 40, 50, 100, 150, 200, 250, 500, 750, 1000, 1250, 1500,
    ];

    const filteredSizes = pageSizes.filter((s, i) => {
      return groups.length > s || i === 0 || groups.length > pageSizes[i - 1];
    });

    return filteredSizes.map((size) => (
      <option key={size} value={size}>
        {size}
      </option>
    ));
  }, [groups.length]);

  if (loading) return <LoadingIndicator />;
  if (!data) return <ErrorMessage error="Error searching for duplicates." />;

  const filteredGroups = groups.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const checkCount = Object.keys(checkedFiles).filter(
    (id) => checkedFiles[id]
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
    setCheckedFiles({});
  };

  const handleCheck = (checked: boolean, fileID: string) => {
    setCheckedFiles({ ...checkedFiles, [fileID]: checked });
  };

  // Keeps one file per image within a duplicate group, preferring the oldest
  // or youngest file by modification time, and selects the remaining files.
  const onSelectAllButAge = (oldest: boolean) => {
    const checkedArray: Record<string, boolean> = {};

    filteredGroups.forEach((group) => {
      // group the duplicate files by the image that they belong to
      const filesByImage = new Map<string, DuplicateItem[]>();
      for (const item of group) {
        const imageFiles = filesByImage.get(item.image.id) ?? [];
        imageFiles.push(item);
        filesByImage.set(item.image.id, imageFiles);
      }

      for (const imageFiles of filesByImage.values()) {
        if (imageFiles.length <= 1) {
          continue;
        }

        const modTime = (item: DuplicateItem) =>
          new Date(item.file.mod_time).getTime();

        const keeper = imageFiles.reduce((keep, item) => {
          const keepTime = modTime(keep);
          const itemTime = modTime(item);
          if (oldest ? itemTime < keepTime : itemTime > keepTime) {
            return item;
          }
          return keep;
        }, imageFiles[0]);

        imageFiles.forEach((item) => {
          if (item.file.id !== keeper.file.id) {
            checkedArray[item.file.id] = true;
          }
        });
      }
    });

    setCheckedFiles(checkedArray);
  };

  // Selects every duplicate file in the preferred folder. Where all the
  // duplicate files of an image are located in the preferred folder, the
  // oldest file is kept unselected so that the image is never left empty.
  const onSelectAllInFolder = () => {
    if (!selectedFolder) {
      return;
    }

    const checkedArray: Record<string, boolean> = {};

    groups.forEach((group) => {
      // group the duplicate files by the image that they belong to
      const filesByImage = new Map<string, DuplicateItem[]>();
      for (const item of group) {
        const imageFiles = filesByImage.get(item.image.id) ?? [];
        imageFiles.push(item);
        filesByImage.set(item.image.id, imageFiles);
      }

      for (const imageFiles of filesByImage.values()) {
        const inFolder = imageFiles.filter(
          (item) => getFolderPath(item.file.path) === selectedFolder
        );

        if (inFolder.length === 0) {
          continue;
        }

        let toSelect = inFolder;
        if (inFolder.length === imageFiles.length) {
          // all the duplicates of this image are in the folder - keep the
          // oldest file unselected
          const oldest = inFolder.reduce((keep, item) => {
            if (
              new Date(item.file.mod_time).getTime() <
              new Date(keep.file.mod_time).getTime()
            ) {
              return item;
            }
            return keep;
          }, inFolder[0]);

          toSelect = inFolder.filter((item) => item.file.id !== oldest.file.id);
        }

        toSelect.forEach((item) => {
          checkedArray[item.file.id] = true;
        });
      }
    });

    setCheckedFiles(checkedArray);
  };

  const deleteFiles = async (fileIDs: string[]) => {
    if (fileIDs.length === 0) {
      return;
    }

    const message = intl.formatMessage(
      { id: "image_dupe_check.delete_confirm" },
      { count: fileIDs.length }
    );
    if (!window.confirm(message)) {
      return;
    }

    await destroyDuplicateImageFiles({
      variables: {
        file_ids: fileIDs,
      },
    });
    refetch();
    resetCheckboxSelection();
  };

  const deleteChecked = () => {
    const fileIDs = groups
      .flat()
      .filter((item) => checkedFiles[item.file.id])
      .map((item) => item.file.id);
    deleteFiles(fileIDs);
  };

  function renderPagination() {
    return (
      <div className="d-flex mt-2 mb-2">
        <h6 className="mr-auto align-self-center">
          <FormattedMessage
            id="dupe_check.found_sets"
            values={{ setCount: groups.length }}
          />
        </h6>
        {checkCount > 0 && (
          <ButtonGroup>
            <OverlayTrigger
              overlay={
                <Tooltip id="delete">
                  {intl.formatMessage({ id: "actions.delete" })}
                </Tooltip>
              }
            >
              <Button variant="danger" onClick={deleteChecked}>
                <Icon icon={faTrash} />
              </Button>
            </OverlayTrigger>
          </ButtonGroup>
        )}
        <Pagination
          itemsPerPage={pageSize}
          currentPage={currentPage}
          totalItems={groups.length}
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
    <>
      <Form>
        <Form.Group>
          {folderOptions.length > 0 && (
            <Row noGutters>
              <Form.Label>
                {intl.formatMessage({ id: "image_dupe_check.folder_label" })}
              </Form.Label>
              <Col xs="auto">
                <Form.Control
                  as="select"
                  className="input-control ml-4 mb-2"
                  value={selectedFolder}
                  onChange={(e) => {
                    setSelectedFolder(e.currentTarget.value);
                    resetCheckboxSelection();
                  }}
                >
                  {folderOptions.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder}
                    </option>
                  ))}
                </Form.Control>
              </Col>
            </Row>
          )}
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

                  <Dropdown.Item onClick={() => onSelectAllButAge(true)}>
                    {intl.formatMessage({
                      id: "image_dupe_check.select_all_but_oldest_copy",
                    })}
                  </Dropdown.Item>

                  <Dropdown.Item onClick={() => onSelectAllButAge(false)}>
                    {intl.formatMessage({
                      id: "image_dupe_check.select_all_but_youngest_copy",
                    })}
                  </Dropdown.Item>

                  {folderOptions.length > 0 && (
                    <Dropdown.Item
                      onClick={onSelectAllInFolder}
                      disabled={!selectedFolder}
                    >
                      {intl.formatMessage({
                        id: "image_dupe_check.select_all_in_folder",
                      })}
                    </Dropdown.Item>
                  )}
                </Dropdown.Menu>
              </Dropdown>
            </Col>
          </Row>
        </Form.Group>
      </Form>

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
          {filteredGroups.map((group, groupIndex) =>
            group.map((item, i) => {
              const file = item.file;
              return (
                <>
                  {i === 0 && groupIndex !== 0 ? (
                    <tr className="separator" />
                  ) : undefined}
                  <tr
                    className={i === 0 ? "duplicate-group" : ""}
                    key={file.id}
                  >
                    <td>
                      <Form.Check
                        checked={checkedFiles[file.id]}
                        onChange={(e) =>
                          handleCheck(e.currentTarget.checked, file.id)
                        }
                      />
                    </td>
                    <td>
                      <HoverPopover
                        content={
                          <img
                            src={item.image.paths.preview ?? ""}
                            alt=""
                            width={400}
                          />
                        }
                        placement="right"
                      >
                        <img
                          src={item.image.paths.thumbnail ?? ""}
                          alt=""
                          width={100}
                          style={{
                            border: checkedFiles[file.id]
                              ? "2px solid red"
                              : "",
                          }}
                        />
                      </HoverPopover>
                    </td>
                    <td className="text-left">
                      <p>
                        <Link
                          to={`/images/${item.image.id}`}
                          style={{
                            fontWeight: checkedFiles[file.id]
                              ? "bold"
                              : "inherit",
                            textDecoration: checkedFiles[file.id]
                              ? "line-through 3px"
                              : "inherit",
                            textDecorationColor: checkedFiles[file.id]
                              ? "red"
                              : "inherit",
                          }}
                        >
                          {" "}
                          {item.image.title
                            ? item.image.title
                            : TextUtils.fileNameFromPath(file.path)}{" "}
                        </Link>
                      </p>
                      <p className="image-path">{file.path}</p>
                    </td>
                    <td className="image-details"> </td>
                    <td>
                      <FileSize size={file.size} />
                    </td>
                    <td>{`${file.width}x${file.height}`}</td>
                    <td>
                      <Button
                        className="edit-button"
                        variant="danger"
                        data-action="delete"
                        onClick={() => deleteFiles([file.id])}
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
      {groups.length === 0 && (
        <h4 className="text-center mt-4">
          <FormattedMessage id="image_dupe_check.no_duplicates" />
        </h4>
      )}
      {renderPagination()}
    </>
  );
};
