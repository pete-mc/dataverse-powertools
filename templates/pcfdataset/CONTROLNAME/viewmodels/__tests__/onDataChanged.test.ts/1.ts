import { ServiceProvider, ControlContextService, DatasetChangedEventArgs } from "pcf-react";
import { ViewModel } from "../ViewModel";
import { DATASETITEM } from "../DATASETITEM";

test("onshowCompleted", async () => {
  const serviceProvider = new ServiceProvider();
  const controlContext = new ControlContextService();
  controlContext.getColumns = jest.fn();

  serviceProvider.register(ControlContextService.serviceProviderName, controlContext);

  const vm = new ViewModel(serviceProvider);

  const getValue = jest.fn().mockReturnValue("test");
  const getRecordId = jest.fn().mockReturnValue("123");
  vm.onDataChanged(controlContext, {
    data: [
      {
        getNamedReference: jest.fn(),
        getFormattedValue: jest.fn(),
        getRecordId: getRecordId,
        getValue: getValue,
      },
    ],
    page: 1,
    pageSize: 25,
    totalPages: 1,
    totalRecords: 25,
  } as DatasetChangedEventArgs);

  expect(vm.data.length).toBe(1);
  expect(vm.data[0]).toMatchObject(
    expect.objectContaining<Partial<DATASETITEM>>({
      id: "123",
      title: "test",
    }),
  );
});
