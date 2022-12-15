// type ReceiveMessageFunctionType = (data: object) => void;

// module FormFunctions {

//     export function ShowField(name: string) {
//         if (name === undefined || name === null || name === "") {
//             throw "No name specified for function 'FormFunctions.ShowField'";
//         }

//         if (name.charAt(0) !== '#') {
//             name = "#" + name;
//         }

//         // either show the TR (when 1 child present) or just the TD (when more than 1 child present)
//         if ($(name).closest("tr").find("td").length > 1) {
//             $(name).closest("td").removeClass("hidden");
//         }
//         else {
//             $(name).closest("tr").removeClass("hidden");
//         }
//     }

//     export function FieldRequired(name: string, required?: boolean) {
//         if (name === undefined || name === null || name === "") {
//             throw "No name specified for function 'FormFunctions.FieldRequired'";
//         }

//         if (name.charAt(0) !== '#') {
//             name = "#" + name;
//         }

//         if (required === undefined || required === null) {
//             required = true;
//         }

//         required = !!required;

//         if (required) {
//             FormFunctions.ShowField(name);
//         }

//         if (required) {
//             $("label" + name + "_label").parent().addClass("required");
//         } else {
//             $("label" + name + "_label").parent().removeClass("required");
//         }
//     }

//     export function ClearField(name: string) {
//         if (name === undefined || name === null || name === "") {
//             throw "No name specified for function 'FormFunctions.HideField'";
//         }

//         if (name.charAt(0) !== '#') {
//             name = "#" + name;
//         }

//         $(name).val(null);

//         // clear lookup field values too, if it is a lookup
//         FormFunctions.SetLookupField(name, null, null, null);
//     }

//     export function SetLookupField(fieldName, logicalName, id, displayName) {
//         if (fieldName === undefined || fieldName === null || fieldName === "") {
//             throw "No fieldname specified for function 'FormFunctions.SetLookupField'";
//         }

//         if (fieldName.charAt(0) !== '#') {
//             fieldName = "#" + fieldName;
//         }

//         $(fieldName).attr("value", id);
//         $(fieldName + "_name").attr("value", displayName);
//         $(fieldName + "_entityname").attr("value", logicalName);
//     }

//     export function HideField(name: string, ignoreRequired?: boolean) {
//         if (name === undefined || name === null || name === "") {
//             throw "No name specified for function 'FormFunctions.HideField'";
//         }

//         if (name.charAt(0) !== '#') {
//             name = "#" + name;
//         }

//         ignoreRequired = !!ignoreRequired;

//         // either hide the TR (when 1 child present) or just the TD (when more than 1 child present)
//         if ($(name).closest("tr").find("td").length > 1) {
//             $(name).closest("td").addClass("hidden");
//         }
//         else {
//             $(name).closest("tr").addClass("hidden");
//         }

//         if (!ignoreRequired) {
//             FormFunctions.FieldRequired(name, false);
//         }
//     }

//     export function HideTableInSection(name: string) {
//         var pageSection = $("[data-name='" + name + "']").parent();
//         $(pageSection).find("table").hide();
//     }
//     export function GenerateRandomString(): string {
//         return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
//     }
//     export function AppendIFrame(parentContainer: JQuery<HTMLElement>, url: string, id?: string, autoResize?: boolean): JQuery.Promise<any, any, any> {
//         if (autoResize === undefined || autoResize == null) {
//             autoResize = true;
//         }

//         if (id === undefined || id === null || id === "") {
//             id = "r" + (new Date()).getTime();
//         }

//         var dfd = $.Deferred();

//         parentContainer.append("<iframe id='" + id + "' src='" + url + "' style='width: 100%; height: 100px' frameBorder='0'></iframe>");

//         if (autoResize) {
//             $("iframe#" + id).on('load', function () {
//                 setInterval(function (el) {
//                     $(el).height($(el).contents().outerHeight());
//                 }, 100, $(this));
//                 dfd.resolve();
//             });
//         }

//         // Return an immutable promise object.
//         // Clients can listen for its done or fail
//         // callbacks but they can't resolve it themselves
//         return dfd.promise();
//     }

//     export function PostMessageToIframe(id: string, message: object): boolean {
//         if ($("iframe#" + id).length > 0) {
//             (<HTMLIFrameElement>$("iframe#" + id)[0]).contentWindow.postMessage(message, "*");
//             return true;
//         }

//         return false;
//     }

//     export function SubscribeToWindowMessages(win: Window, fun: ReceiveMessageFunctionType, _this: object) {
//         // listen to updates from the web resource
//         $(win).on("message onmessage", function (e: any) {
//             var data = e.originalEvent.data;
//             fun.call(_this, data);
//         });
//     }

//     export function ExposeContent() {
//         $('.unwrapMe').contents().unwrap();
//         $('.unwrapMeLoadCompleted').remove();
//     }

//     export function AddNotificationTocladeNotificationsBar(message: string, alertClassType: string): boolean {
//         if ($(".cladenotificationbar").length > 0) {
//             $(".cladenotificationbar").append('<div class="alert alert-' + alertClassType + '" role="alert">' + message + '</div>');
//             $(".cladenotificationbar").removeClass("hidden");
//             return true;
//         }

//         return false;
//     }

//     export function AddDismissableNotificationTocladeNotificationsBar(message: string, alertClassType: string): boolean {
//         if ($(".cladenotificationbar").length > 0) {
//             $(".cladenotificationbar").append('<div class="alert alert-' + alertClassType + '" role="alert">' + message + '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>');
//             $(".cladenotificationbar").removeClass("hidden");
//             return true;
//         }

//         return false;
//     }

//     export function qs(key): string {
//         key = key.replace(/[*+?^$.\[\]{}()|\\\/]/g, "\\$&"); // escape RegEx meta chars
//         var match = location.search.match(new RegExp("[?&]" + key + "=([^&]+)(&|$)"));
//         return match && decodeURIComponent(match[1].replace(/\+/g, " "));
//     }
// }