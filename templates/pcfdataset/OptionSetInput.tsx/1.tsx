/* eslint-disable @typescript-eslint/explicit-function-return-type */
import * as React from "react";
import { Dropdown, IDropdownOption, IDropdownProps } from "@fluentui/react";

export interface OptionSetProps {
  value: number | null;
  label?: string;
  options?: ComponentFramework.PropertyHelper.OptionMetadata[];
  showBlank?: boolean;
  blankText?: string;
  onChange: (newValue: number | null) => void;
  dropDownProps?: IDropdownProps;
}

export class OptionSetInput extends React.Component<OptionSetProps> {
  constructor(props: OptionSetProps) {
    super(props);
  }

  onChange = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption | undefined): void => {
    const selectedKey = item?.key == null ? -1 : (item.key as number);
    this.props.onChange(selectedKey != -1 ? selectedKey : null);
  };

  render(): JSX.Element {
    const { options, value, blankText, showBlank, label } = this.props;
    const blankTextLabel = blankText || "--Select--";
    let dropDownOptions =
      (options &&
        options.map((v) => {
          return {
            key: v.Value,
            text: v.Label,
          } as IDropdownOption;
        })) ||
      [];

    if (showBlank) {
      dropDownOptions = [{ key: -1, text: blankTextLabel } as IDropdownOption].concat(dropDownOptions);
    }
    const selectedValue = value == null ? -1 : value;
    return (
      <Dropdown
        label={label}
        selectedKey={selectedValue}
        onChange={this.onChange}
        options={dropDownOptions || []}
        styles={{ dropdown: { width: "100%" } }}
        {...this.props.dropDownProps}
      />
    );
  }
}
