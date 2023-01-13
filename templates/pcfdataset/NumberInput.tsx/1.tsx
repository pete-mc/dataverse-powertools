/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { ITextFieldProps, TextField } from "@fluentui/react";
import * as React from "react";

export interface NumberInputProps {
  label?: string;
  value: number | null;
  textFieldProps?: ITextFieldProps;
  decimalPlaces: number;
  maxValue?: number;
  onChange: (newValue: number | null) => void;
}
export interface NumberInputState {
  isEditing: boolean;
  textValue?: string;
  numberValue: number | null;
}
export class NumberInput extends React.Component<NumberInputProps, NumberInputState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(props: NumberInputProps) {
    super(props);
    this.state = {
      isEditing: false,
      textValue: this.formatNumber(this.props.value),
      numberValue: this.props.value,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange = (event: unknown, newValue?: string | undefined): void => {
    // Remove any non-numeric chars
    const formattedNewValue = newValue && newValue.replace(/[^0-9|.|-]/gi, "");
    let numberValue = formattedNewValue ? Number.parseFloat(formattedNewValue as string) : null;
    if (this.props.maxValue && numberValue) {
      if (numberValue > this.props.maxValue) numberValue = this.props.maxValue;
    }

    this.setState({
      isEditing: true,
      textValue: formattedNewValue,
      numberValue: numberValue,
    });
  };

  onBlur = (): void => {
    if (!this.state.isEditing) return;
    this.setState({
      isEditing: false,
      textValue: this.formatNumber(this.state.numberValue),
    });
    if (this.props.onChange) this.props.onChange(this.state.numberValue);
  };

  formatNumber(value?: number | null): string {
    return value != null ? value.toFixed(this.props.decimalPlaces) : "";
  }

  render(): JSX.Element {
    const { isEditing, textValue } = this.state;
    const { value, label } = this.props;
    return (
      <TextField
        placeholder="---"
        label={label}
        value={isEditing ? textValue : this.formatNumber(value)}
        onBlur={this.onBlur}
        onChange={this.onChange}
        {...this.props.textFieldProps}
      ></TextField>
    );
  }
}
