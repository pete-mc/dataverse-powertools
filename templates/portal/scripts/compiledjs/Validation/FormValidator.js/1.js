var Clade;
(function (Clade) {
    var Validation;
    (function (Validation) {
        var FormValidator = /** @class */ (function () {
            function FormValidator(onSubmitValidator) {
                if (window.jQuery) {
                    (function ($) {
                        if (typeof (webFormClientValidate) != 'undefined') {
                            var originalValidationFunction = webFormClientValidate;
                            if (originalValidationFunction && typeof (originalValidationFunction) == "function") {
                                webFormClientValidate = function () {
                                    originalValidationFunction.apply(this, arguments);
                                    return onSubmitValidator();
                                };
                            }
                        }
                    }(window.jQuery));
                }
            }
            return FormValidator;
        }());
        Validation.FormValidator = FormValidator;
    })(Validation = Clade.Validation || (Clade.Validation = {}));
})(Clade || (Clade = {}));
//# sourceMappingURL=FormValidator.js.map