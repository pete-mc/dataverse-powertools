var FormAPIWrapper;
(function (FormAPIWrapper) {
    var API = /** @class */ (function () {
        function API() {
        }
        API.safeAjax = function (ajaxOptions) {
            var deferredAjax = $.Deferred();
            shell.getTokenDeferred().done(function (token) {
                // add headers for AJAX
                if (!ajaxOptions.headers) {
                    $.extend(ajaxOptions, {
                        headers: {
                            "__RequestVerificationToken": token
                        }
                    });
                }
                else {
                    ajaxOptions.headers["__RequestVerificationToken"] = token;
                }
                $.ajax(ajaxOptions)
                    .done(function (data, textStatus, jqXHR) {
                    validateLoginSession(data, textStatus, jqXHR, deferredAjax.resolve);
                }).fail(deferredAjax.reject); //AJAX
            }).fail(function () {
                deferredAjax.rejectWith(this, arguments); // on token failure pass the token AJAX and args
            });
            return deferredAjax.promise();
        };
        return API;
    }());
    FormAPIWrapper.API = API;
})(FormAPIWrapper || (FormAPIWrapper = {}));
//# sourceMappingURL=FormAPIWrapper.js.map