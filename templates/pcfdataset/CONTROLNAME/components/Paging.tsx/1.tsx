import * as React from "react";
import { Stack, IconButton } from "@fluentui/react";
import { ViewModel } from "../viewmodels/ViewModel";
import { ServiceProviderContext } from "../viewmodels/context";
import { ServiceProvider } from "pcf-react";
import { observer } from "mobx-react";
export class Paging extends React.Component<unknown> {
  context!: React.ContextType<typeof ServiceProviderContext>;
  vm: ViewModel;
  constructor(props: unknown, context: ServiceProvider) {
    super(props);
    this.vm = context.get<ViewModel>(ViewModel.serviceProviderName);
  }
  render(): JSX.Element {
    const fromRecord = (this.vm.pageNumber - 1) * this.vm.pageSize + 1;
    const totalRecords = this.vm.totalRecords;
    const toRecord =
      this.vm.totalRecords && fromRecord + this.vm.pageSize >= this.vm.totalRecords
        ? this.vm.totalRecords
        : this.vm.pageNumber * this.vm.pageSize;
    const selectedCount = this.vm.selection.length;

    return (
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 16 }}>
        <Stack.Item grow>
          {fromRecord} - {toRecord} of {totalRecords} ({selectedCount} selected)
        </Stack.Item>
        <Stack.Item>
          <IconButton iconProps={{ iconName: "Previous" }} onClick={this.vm.onPageFirst} disabled={fromRecord == 1} />
          <IconButton iconProps={{ iconName: "Back" }} onClick={this.vm.onPageBack} disabled={fromRecord == 1} />
          <IconButton
            iconProps={{ iconName: "Forward" }}
            onClick={this.vm.onPageNext}
            disabled={totalRecords ? toRecord >= totalRecords : false}
          />
        </Stack.Item>
      </Stack>
    );
  }
}
Paging.contextType = ServiceProviderContext;
observer(Paging);
