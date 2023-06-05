declare namespace PowerTools {
  /**
   * Specifies the event that will be registered in dataverse.
   * @interface RegisterEvent
   */
  export interface RegisterEvent {
    /**
     * The unique identifier of the form in Dataverse.
     * @member {string} RegisterEvent#formId
     */
    formId: string;
    /**
     * The event that the function should be triggered on.
     * @member {string} RegisterEvent#event
     */
    event: "onload" | "onsave";
    /**
     * The name of the function to be triggered. in Library.Class.Function format
     * @member {string} RegisterEvent#function
     */
    function: string;
    /**
     * Specifiy a Unique ID (GUID) for the trigger
     * @member {string} RegisterEvent#triggerId
     */
    triggerId: string;
    /**
     * whether to pass the execution context as the first parameter
     * @member {string} RegisterEvent#executionContext
     */
    executionContext: boolean;
    /**
     * Optionally, add extra paramaters to pass.
     * @member {string} RegisterEvent#parameters
     */
    parameters?: string;
  }
}
