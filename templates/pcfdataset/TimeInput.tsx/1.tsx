/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { ComboBox, IComboBoxOption, IComboBoxProps, IComboBox } from "@fluentui/react";
import * as React from "react";
import { observer } from "mobx-react";
import moment = require("moment");
export interface TimeInputProps {
  label?: string;
  comboBoxProps?: IComboBoxProps;
  value?: Date;
  disabled?: boolean;
  onChange?: (time?: Date) => unknown;
  userSettings: ComponentFramework.UserSettings;
  formatting: ComponentFramework.Formatting;
}
export interface TimeInputState {
  timeOptions: IComboBoxOption[];
}

export class TimeInput extends React.Component<TimeInputProps, TimeInputState> {
  isControlMounted: boolean;

  constructor(props: TimeInputProps) {
    super(props);
    this.state = {
      timeOptions: this.getOptions(),
    };
  }

  onChange = async (
    event: React.FormEvent<IComboBox>,
    option?: IComboBoxOption,
    index?: number,
    value?: string,
  ): Promise<void> => {
    if (this.props.onChange) {
      if (option) {
        const keyData = new Date(option.key);
        this.props.onChange(keyData);
      } else {
        // moment uses A - but PowerApps uses tt as the am/pm
        if (this.props.userSettings) {
          const formatString = this.props.userSettings.dateFormattingInfo.shortTimePattern.replace("tt", "A");
          const parsed = moment(value, formatString);
          if (parsed.isValid()) {
            this.props.onChange(parsed.toDate());
          }
        }
      }
    }
  };
  getOptions(): IComboBoxOption[] {
    const options: IComboBoxOption[] = [];
    const date = new Date();
    for (let i = 0; i < 24 * 60; i = i + 30) {
      const localDate = moment(i * 60000).utc();
      const date = new Date(
        localDate.year(),
        localDate.month(),
        localDate.date(),
        localDate.hour(),
        localDate.minute(),
      );

      const timeString = this.formatTime(date) as string;
      options.push({
        key: date.toISOString(),
        text: timeString,
      });
    }

    return options;
  }
  formatTime(timePart: Date): string {
    const datePart = this.props.formatting.formatDateShort(timePart, false);
    return this.props.formatting.formatTime(timePart, 0).replace(datePart, "");
  }
  render(): JSX.Element {
    const { value, label, disabled } = this.props;
    const { timeOptions } = this.state;
    const displayText = value ? this.formatTime(value) : "";
    return (
      <ComboBox
        label={label}
        disabled={disabled}
        placeholder="---"
        allowFreeform={true}
        autoComplete="on"
        options={timeOptions}
        onChange={this.onChange}
        text={displayText}
        buttonIconProps={{ iconName: "Clock" }}
        useComboBoxAsMenuWidth={true}
        styles={{ optionsContainerWrapper: { maxHeight: 200 } }}
        {...this.props.comboBoxProps}
      />
    );
  }
}

observer(TimeInput);
