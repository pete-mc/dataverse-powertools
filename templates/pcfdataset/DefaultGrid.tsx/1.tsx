import * as React from "react";
import {
  DetailsList,
  Selection,
  ConstrainMode,
  IObjectWithKey,
  IColumn,
  ScrollablePane,
  ScrollbarVisibility,
  IRenderFunction,
  IDetailsHeaderProps,
  TooltipHost,
  Sticky,
  StickyPositionType,
  IDetailsColumnRenderTooltipProps,
} from "@fluentui/react";
import { DATASETITEM } from "../viewmodels/DATASETITEM";
import { ServiceProviderContext } from "../viewmodels/context";
import { ServiceProvider } from "pcf-react";
import { ViewModel } from "../viewmodels/ViewModel";
import { observer, Observer } from "mobx-react";
import { TextInput } from "./pcf-fluent-ui/TextInput";

export class DefaultGrid extends React.Component<unknown> {
  context!: React.ContextType<typeof ServiceProviderContext>;
  selection: Selection<DATASETITEM>;
  vm: ViewModel;

  constructor(props: unknown, context: ServiceProvider) {
    super(props);
    this.vm = context.get<ViewModel>(ViewModel.serviceProviderName);
    this.selection = new Selection<DATASETITEM>({
      onSelectionChanged: (): void => {
        this.vm.onSelectionChanged(this.selection.getSelection());
      },
    });
  }
  onRenderItemColumn = (item?: DATASETITEM, index?: number | undefined, column?: IColumn | undefined): JSX.Element => {
    if (!column || !column.fieldName || !item) return <></>;

    switch (column.key) {
      case "TEXTPARAMETERSET":
        return (
          <Observer>
            {() => <TextInput value={item.title} onChange={item.onChangeTitle} showEditOnFocus={true} />}
          </Observer>
        );
      default:
        return <>{item?.record.getFormattedValue(column.fieldName as string)}</>;
    }
  };

  onColumnClick = (ev: unknown, column?: IColumn): void => {
    if (!column) return;
    this.vm.onSort(column.fieldName as string, column.isSortedDescending == false);
  };
  onRenderDetailsHeader: IRenderFunction<IDetailsHeaderProps> = (props, defaultRender) => {
    if (!props) {
      return null;
    }
    const onRenderColumnHeaderTooltip: IRenderFunction<IDetailsColumnRenderTooltipProps> = (tooltipHostProps) => (
      <TooltipHost {...tooltipHostProps} />
    );
    return (
      <Sticky stickyPosition={StickyPositionType.Header} isScrollSynced>
        {defaultRender &&
          defaultRender({
            ...props,
            onRenderColumnHeaderTooltip,
          })}
      </Sticky>
    );
  };

  render(): JSX.Element {
    const { DATASETITEMS, datagridColumns, onOpenItem } = this.vm;

    return (
      // <div style={{ position: "relative", height: "100%" }}>
      //   <ScrollablePane scrollbarVisibility={ScrollbarVisibility.auto}>
          <DetailsList
            onColumnHeaderClick={this.onColumnClick}
            constrainMode={ConstrainMode.unconstrained}
            items={DATASETITEMS}
            columns={datagridColumns}
            selection={this.selection as Selection<IObjectWithKey>}
            onRenderItemColumn={this.onRenderItemColumn}
            onItemInvoked={onOpenItem}
            onRenderDetailsHeader={this.onRenderDetailsHeader}
          />
      //   </ScrollablePane>
      // </div>
    );
  }
}

DefaultGrid.contextType = ServiceProviderContext;
observer(DefaultGrid);
