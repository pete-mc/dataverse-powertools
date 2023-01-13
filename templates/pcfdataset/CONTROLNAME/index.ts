import { ServiceProvider, StandardControlReact } from "pcf-react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { ViewModel } from "./viewmodels/ViewModel";
import { DatasetComponent } from "./components/DatasetComponent";
import { CdsService } from "./viewmodels/CdsService";
export class MyTestControlTest extends StandardControlReact<IInputs, IOutputs> {
  constructor () {
    super()
    this.renderOnParametersChanged = false
    this.renderOnDatasetChanged = false

    this.initServiceProvider = (serviceProvider: ServiceProvider): void => {
      const vm = new ViewModel(serviceProvider)
      serviceProvider.register(ViewModel.serviceProviderName, vm)
      //vm.TEXTPARAMETER = this.context.parameters.TEXTPARAMETER.raw
      const titleFieldAttribute = "" // this.context.parameters.dataset.columns.find((c) => c.alias == 'TEXTPARAMETERSET')?.name
      // vm.setSelectedRecordIds = this.context.parameters.dataset.setSelectedRecordIds;
      vm.pcfContext = this.context

      serviceProvider.register(
        CdsService.serviceProviderName,
        new CdsService(this.context, {
          todoEntityType: this.context.parameters.dataset.getTargetEntityType(),
          textField: titleFieldAttribute as string
        })
      )
    }

    this.reactCreateElement = (container, width, height, serviceProvider): void => {
      ReactDOM.render(
        React.createElement(DatasetComponent, {
          serviceProvider: serviceProvider
        }),
        container
      )
    }
  }
}
