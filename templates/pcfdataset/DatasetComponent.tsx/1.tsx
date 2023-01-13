import * as React from "react";
import { ServiceProvider } from "pcf-react";
import { ServiceProviderContext } from "../viewmodels/context";
import { CONTROLNAMEAPP } from "./CONTROLNAMEAPP";

export interface DatasetComponentProps {
  serviceProvider: ServiceProvider;
}

export class DatasetComponent extends React.Component<DatasetComponentProps> {
  render(): JSX.Element {
    return (
      <ServiceProviderContext.Provider value={this.props.serviceProvider}>
        <CONTROLNAMEAPP />
      </ServiceProviderContext.Provider>
    );
  }
}
