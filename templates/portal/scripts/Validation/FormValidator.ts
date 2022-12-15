// declare var webFormClientValidate: any;

// module Clade 
// {
//     export module Validation {
//         export class FormValidator {
//             constructor(onSubmitValidator: Function) {
//                 if ((<any>window).jQuery) {
//                     (function ($: JQueryStatic) {
//                         if (typeof (webFormClientValidate) != 'undefined') {
//                             var originalValidationFunction = webFormClientValidate;
//                             if (originalValidationFunction && typeof (originalValidationFunction) == "function") {
//                                 webFormClientValidate = function () {
//                                     originalValidationFunction.apply(this, arguments);
//                                     return onSubmitValidator();
//                                 };
//                             }
//                         }
//                     }((<any>window).jQuery));
//                 }
//             }
//         }
//     }
// }