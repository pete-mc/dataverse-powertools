/// <reference path="../definition/validator.ts" />
var Clade;
(function (Clade) {
    var Validation;
    (function (Validation) {
        var FieldValidator = /** @class */ (function () {
            function FieldValidator(fieldname, evalFunction, message, validationGroup) {
                this.errormessage = "";
                this.validationGroup = "";
                if (fieldname === "" || fieldname === undefined || fieldname === null) {
                    console.log("No fieldname specified to validate");
                    throw "No fieldname specified to validate";
                }
                if (evalFunction === undefined || evalFunction === null) {
                    console.log("No evaluation function specified to validate field " + fieldname);
                    throw "No evaluation function specified to validate field " + fieldname;
                }
                var regex = /[0-9a-zA-Z_]/gi;
                this.id = "cladeVal" + this.validationGroup.replace(regex, "") + fieldname;
                this.errorLabelId = "#" + fieldname + "_label";
                this.controltovalidate = fieldname;
                this.evaluationfunction = evalFunction;
                this.errormessage =
                    "<a href='" + this.errorLabelId + "'>" +
                        ((message === undefined || message === null) ? "Error validating field" : message) +
                        "</a>";
                this.validationGroup = validationGroup;
            }
            FieldValidator.prototype.setData = function (data) {
                this.data = data;
            };
            FieldValidator.prototype.createInstance = function () {
                if (this.id === undefined) {
                    console.log("id not defined on validator - can't output validator to page");
                    throw "id not defined on validator - can't output validator to page";
                }
                if (typeof Page_Validators == 'undefined') {
                    console.log("Page_Validators variable not defined on page - can't output validator to page");
                    return;
                }
                var functionToCall = this.evaluationfunction;
                var newValidator = (document.createElement('span'));
                newValidator.style.display = "none";
                newValidator.id = this.id;
                newValidator.controltovalidate = this.controltovalidate;
                newValidator.errormessage = this.errormessage;
                newValidator.validationGroup = this.validationGroup;
                newValidator.initialvalue = "";
                newValidator.evaluationfunction = functionToCall;
                newValidator.data = this.data;
                // Add the new validator to the page validators array:
                Page_Validators.push(newValidator);
                var labelId = this.errorLabelId;
                var control = this.controltovalidate;
                // Wire-up the click event handler of the validation summary link
                $("a[href='" + labelId + "']").on("click", function () { scrollToAndFocus(labelId, control); });
            };
            FieldValidator.removeValidator = function (fieldname, validationGroup) {
                var validators = window.Page_Validators;
                if (validators == undefined)
                    return;
                var validatorId = "cladeVal" + fieldname;
                var regex = /[0-9a-zA-Z_]/gi;
                if (validationGroup) {
                    var validatorId = "cladeVal" + validationGroup.replace(regex, "") + fieldname;
                }
                for (var _i = 0, validators_1 = validators; _i < validators_1.length; _i++) {
                    var validator = validators_1[_i];
                    var id = validator.id;
                    if (id.indexOf(validatorId) > -1) {
                        Array.remove(validators, validator);
                        return;
                    }
                }
            };
            FieldValidator.removeValidatorStandard = function (fieldName) {
                $.each(Page_Validators, function (index, validator) {
                    if (validator.id == "RequiredFieldValidator" + fieldName) {
                        Page_Validators.splice(index, 1);
                    }
                });
                $("#" + fieldName + "_label").parent().removeClass("required");
            };
            return FieldValidator;
        }());
        Validation.FieldValidator = FieldValidator;
        var RequiredFieldValidator = /** @class */ (function () {
            function RequiredFieldValidator(fieldname, message, validationGroup) {
                this.validator = new Clade.Validation.FieldValidator(fieldname, function () {
                    var selectedValue = $("#" + this.controltovalidate).val();
                    return selectedValue !== null && selectedValue !== "";
                }, message, validationGroup);
                this.validator.createInstance();
            }
            return RequiredFieldValidator;
        }());
        Validation.RequiredFieldValidator = RequiredFieldValidator;
    })(Validation = Clade.Validation || (Clade.Validation = {}));
})(Clade || (Clade = {}));
//# sourceMappingURL=FieldValidation.js.map