import { observer } from "mobx-react";
import * as React from "react";
import { Stack, Spinner, SpinnerSize } from "@fluentui/react";
import { ServiceProviderContext } from "../viewmodels/context";
import { ViewModel } from "../viewmodels/ViewModel";
import { ServiceProvider } from "pcf-react";
export class Header extends React.Component<unknown> {
  context!: React.ContextType<typeof ServiceProviderContext>;
  vm: ViewModel;
  constructor(props: unknown, context: ServiceProvider) {
    super(props);
    this.vm = context.get<ViewModel>(ViewModel.serviceProviderName);
  }
  render(): JSX.Element {
    const { isBusy } = this.vm;

    return (
      <Stack horizontal verticalAlign="center" horizontalAlign="start" tokens={{ childrenGap: 16 }}>
        <Stack.Item>{isBusy && <Spinner size={SpinnerSize.medium} />}</Stack.Item>
      </Stack>
    );
  }
}
Header.contextType = ServiceProviderContext;
observer(Header);
