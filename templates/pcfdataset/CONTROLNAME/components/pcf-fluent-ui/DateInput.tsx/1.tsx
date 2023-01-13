/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { DatePicker, IDatePickerProps } from "@fluentui/react";
import * as React from "react";
import { TimeInput } from "./TimeInput";
import * as moment from "moment";

export interface DateInputPicker {
  label?: string;
  value: Date | null;
  datePickerProps?: IDatePickerProps;
  onChange: (newValue: Date | null) => void;
  userSettings: ComponentFramework.UserSettings;
  formatting: ComponentFramework.Formatting;
  dateOnly?: boolean;
}
export interface DateInputState {
  isEditing: boolean;
  textValue?: string;
  dateValue: Date | null;
}
export class DateInput extends React.Component<DateInputPicker, DateInputState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(props: DateInputPicker) {
    super(props);
    this.state = {
      isEditing: false,
      dateValue: this.props.value,
    };
  }

  onSelectDate = (date?: Date | null): void => {
    // Exract out the existing time to preserve it
    if (this.props.value) {
      date?.setHours(this.props.value.getHours());
      date?.setMinutes(this.props.value.getMinutes());
      date?.setSeconds(this.props.value.getSeconds());
    }
    const newDate = date != undefined ? date : null;
    this.props.onChange(newDate);
  };
  onFormatDate = (date?: Date): string => {
    if (date) {
      return this.props.formatting.formatDateShort(date);
    }
    return "";
  };
  parseDate = (dateStr: string): Date => {
    return moment(dateStr, this.props.userSettings.dateFormattingInfo.shortDatePattern.toUpperCase()).toDate();
  };
  onTimeChanged = (time?: Date | undefined): void => {
    // Extract out the existng date and preserve it
    if (this.props.value) {
      time?.setFullYear(this.props.value.getFullYear());
      time?.setMonth(this.props.value.getMonth());
      time?.setDate(this.props.value.getDate());
    }
    const newDate = time != undefined ? time : null;
    this.props.onChange(newDate);
  };
  render(): JSX.Element {
    const { dateOnly, value, label } = this.props;
    const dateValue = value != null ? value : undefined;
    return (
      <>
        <DatePicker
          label={label}
          placeholder="---"
          allowTextInput={true}
          value={dateValue}
          formatDate={this.onFormatDate}
          parseDateFromString={this.parseDate}
          onSelectDate={this.onSelectDate}
          {...this.props.datePickerProps}
        />
        {dateOnly != true && (
          <TimeInput
            value={dateValue}
            userSettings={this.props.userSettings}
            formatting={this.props.formatting}
            onChange={this.onTimeChanged}
          />
        )}
      </>
    );
  }
}
