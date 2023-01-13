import { Stack } from "@fluentui/react";
import { observer } from "mobx-react";
import { ServiceProvider } from "pcf-react";
import * as React from "react";
import { ServiceProviderContext } from "../viewmodels/context";
import { ViewModel } from "../viewmodels/ViewModel";
import { CONTROLNAME } from "./CONTROLNAME";
import { Paging } from "./Paging";
import { Header } from "./Header";
import { DefaultGrid } from "./DefaultGrid";
export class CONTROLNAMEAPP extends React.Component<unknown> {
  context!: React.ContextType<typeof ServiceProviderContext>;
  vm: ViewModel;
  constructor(props: unknown, context: ServiceProvider) {
    super(props);
    this.vm = context.get<ViewModel>(ViewModel.serviceProviderName);
  }

  render(): JSX.Element {
    this.vm = this.context.get<ViewModel>(ViewModel.serviceProviderName);
    return (
      <Stack
        grow
        styles={{
          root: {
            height: "100%",
            width: "100%",
          },
        }}
      >
        <Stack.Item
          verticalFill
          styles={{
            root: {
              height: "100%",
              overflowY: "auto",
              overflowX: "auto",
            },
          }}
        >
          {true ? <DefaultGrid /> : <CONTROLNAME />}
        </Stack.Item>
        <Stack.Item grow tokens={{ margin: 4 }}>
          <Paging />
        </Stack.Item>
      </Stack>
    );
  }
}
CONTROLNAMEAPP.contextType = ServiceProviderContext;
observer(CONTROLNAMEAPP);
