// /// <reference path="../../Validator.ts" />

// declare var Page_Validators: any;
// declare var scrollToAndFocus: Function;
// module Clade {
//     export module Validation {
//         export class FieldValidator {
//             style: CSSStyleDeclaration;
//             id: string;
//             errormessage: string = "";
//             validationGroup: string = "";
//             initialvalue: string;
//             controltovalidate: string;
//             errorLabelId: string;
//             evaluationfunction: Function;
//             data: object;

//             constructor(fieldname: string, evalFunction: Function, message: string, validationGroup?: string) {

//                 if (fieldname === "" || fieldname === undefined || fieldname === null) {
//                     console.log("No fieldname specified to validate");
//                     throw "No fieldname specified to validate";
//                 }

//                 if (evalFunction === undefined || evalFunction === null) {
//                     console.log("No evaluation function specified to validate field " + fieldname);
//                     throw "No evaluation function specified to validate field " + fieldname;
//                 }

//                 var regex = /[0-9a-zA-Z_]/gi;
//                 this.id = "cladeVal" + this.validationGroup.replace(regex, "") + fieldname;
//                 this.errorLabelId = "#" + fieldname + "_label";
//                 this.controltovalidate = fieldname;
//                 this.evaluationfunction = evalFunction;
//                 this.errormessage =
//                     "<a href='" + this.errorLabelId + "'>" +
//                     ((message === undefined || message === null) ? "Error validating field" : message) +
//                     "</a>";
//                 this.validationGroup = validationGroup;
//             }

//             setData(data: object) {
//                 this.data = data;
//             }

//             public createInstance() {
//                 if (this.id === undefined) {
//                     console.log("id not defined on validator - can't output validator to page")
//                     throw "id not defined on validator - can't output validator to page";
//                 }

//                 if (typeof (<any>Page_Validators) == 'undefined') {
//                     console.log("Page_Validators variable not defined on page - can't output validator to page")
//                     return;
//                 }

//                 var functionToCall = this.evaluationfunction;
//                 var newValidator = <Validator><any>(document.createElement('span'));
//                 newValidator.style.display = "none";
//                 newValidator.id = this.id;
//                 newValidator.controltovalidate = this.controltovalidate;
//                 newValidator.errormessage = this.errormessage;
//                 newValidator.validationGroup = this.validationGroup;
//                 newValidator.initialvalue = "";
//                 newValidator.evaluationfunction = functionToCall;
//                 newValidator.data = this.data;

//                 // Add the new validator to the page validators array:
//                 Page_Validators.push(newValidator);

//                 var labelId = this.errorLabelId;
//                 var control = this.controltovalidate;
//                 // Wire-up the click event handler of the validation summary link
//                 $("a[href='" + labelId + "']").on("click", function () { scrollToAndFocus(labelId, control); });
//             }

//             public static removeValidator(fieldname: string, validationGroup?: string): void {
//                 var validators: Array<any> = (<any>window).Page_Validators;

//                 if (validators == undefined) return;
//                 var validatorId = "cladeVal" + fieldname;
//                 var regex = /[0-9a-zA-Z_]/gi;
//                 if (validationGroup) {
//                     var validatorId = "cladeVal" + validationGroup.replace(regex, "") + fieldname;
//                 }

//                 for (let validator of validators) {
//                     var id: string = validator.id;
//                     if (id.indexOf(validatorId) > -1) {
//                         (<any>Array).remove(validators, validator);
//                         return;
//                     }
//                 }
//             }
//             public static removeValidatorStandard(fieldName: string) {
//                 $.each(Page_Validators, function (index, validator) {
//                     if (validator.id == "RequiredFieldValidator" + fieldName) {
//                         Page_Validators.splice(index, 1);
//                     }
//                 });
//                 $("#" + fieldName + "_label").parent().removeClass("required");
//             }
//         }

//         export class RequiredFieldValidator {
//             validator: FieldValidator;

//             constructor(fieldname: string, message: string, validationGroup?: string) {
//                 this.validator = new Clade.Validation.FieldValidator(
//                     fieldname,
//                     function () {
//                         var selectedValue = $("#" + this.controltovalidate).val();
//                         return selectedValue !== null && selectedValue !== "";
//                     },
//                     message,
//                     validationGroup
//                 );

//                 this.validator.createInstance();
//             }
//         }


//     }
// }