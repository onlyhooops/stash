import React from "react";
import { Col, Form, Row } from "react-bootstrap";
import { useIntl } from "react-intl";

export type DuplicateType = "perceptual" | "identical";

interface IProps {
  value: DuplicateType;
  onChange: (type: DuplicateType) => void;
}

export const DuplicateTypeSelector: React.FC<IProps> = ({
  value,
  onChange,
}) => {
  const intl = useIntl();

  return (
    <Form.Group>
      <Row noGutters>
        <Form.Label>
          {intl.formatMessage({ id: "image_dupe_check.type_label" })}
        </Form.Label>
        <Col xs="auto">
          <Form.Control
            as="select"
            className="input-control ml-4"
            value={value}
            onChange={(e) => onChange(e.currentTarget.value as DuplicateType)}
          >
            <option value="perceptual">
              {intl.formatMessage({ id: "image_dupe_check.type_perceptual" })}
            </option>
            <option value="identical">
              {intl.formatMessage({ id: "image_dupe_check.type_identical" })}
            </option>
          </Form.Control>
        </Col>
      </Row>
    </Form.Group>
  );
};
