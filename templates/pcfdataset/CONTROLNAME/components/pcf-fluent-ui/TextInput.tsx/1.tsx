/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { ITextFieldProps, TextField } from "@fluentui/react";
import * as React from "react";
import { observer } from "mobx-react";

export interface TextInputProps {
  label?: string;
  textFieldProps?: ITextFieldProps;
  maxLength?: number;
  showEditOnFocus?: boolean;
  value: string | null;
  onChange: (newValue: string | null) => void;
}
export interface TextInputState {
  isEditing: boolean;
  textValue: string;
}
export class TextInput extends React.Component<TextInputProps, TextInputState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(props: TextInputProps) {
    super(props);
    this.state = {
      isEditing: false,
      textValue: this.props.value || "",
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange = (event: unknown, newValue?: string | undefined): void => {
    this.setState({
      isEditing: true,
      textValue: newValue || "",
    });
  };
  onFocus = (): void => {
    this.setState({
      isEditing: true,
      textValue: this.props.value || "",
    });
  };
  onBlur = (): void => {
    if (!this.state.isEditing) return;
    this.setState({
      isEditing: false,
    });
    if (this.props.onChange) this.props.onChange(this.state.textValue);
  };
  onKeyPress = (ev: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    // If escape, cancel edit
    switch (ev.key) {
      case "Escape":
        this.setState({
          isEditing: false,
        });
        break;
      case "Enter":
        this.onBlur();
        break;
    }
  };
  render(): JSX.Element {
    const { isEditing, textValue } = this.state;
    const { label, value, showEditOnFocus } = this.props;
    const showTextField = showEditOnFocus != true || isEditing;
    return showTextField ? (
      <TextField
        autoFocus={showEditOnFocus == true}
        onKeyDownCapture={this.onKeyPress}
        placeholder="---"
        label={label}
        value={isEditing ? textValue : (value as string)}
        onBlur={this.onBlur}
        onChange={this.onChange}
        {...this.props.textFieldProps}
      ></TextField>
    ) : (
      <div onClick={this.onFocus} style={{ cursor: "default" }}>
        {value}
      </div>
    );
  }
}
observer(TextField);
