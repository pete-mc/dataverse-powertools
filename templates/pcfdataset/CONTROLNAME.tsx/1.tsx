import * as React from "react";
import { ServiceProviderContext } from "../viewmodels/context";
import { ServiceProvider } from "pcf-react";
import { ViewModel } from "../viewmodels/ViewModel";
import { observer } from "mobx-react";
import { initializeIcons } from "@uifabric/icons";
initializeIcons();

export class CONTROLNAME extends React.Component<unknown> {
  context: React.ContextType<typeof ServiceProviderContext>;
  vm: ViewModel;
  constructor(props: unknown, context: ServiceProvider) {
    super(props);
    this.vm = context.get<ViewModel>(ViewModel.serviceProviderName);
  }

  render(): JSX.Element {
    this.vm = this.context.get<ViewModel>(ViewModel.serviceProviderName);
    return <div>CONTROL CONTENT</div>;
  }
}

CONTROLNAME.contextType = ServiceProviderContext;
observer(CONTROLNAME);
