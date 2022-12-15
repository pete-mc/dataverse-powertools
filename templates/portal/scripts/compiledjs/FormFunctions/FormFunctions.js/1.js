var FormFunctions;
(function (FormFunctions) {
    function ShowField(name) {
        if (name === undefined || name === null || name === "") {
            throw "No name specified for function 'FormFunctions.ShowField'";
        }
        if (name.charAt(0) !== '#') {
            name = "#" + name;
        }
        // either show the TR (when 1 child present) or just the TD (when more than 1 child present)
        if ($(name).closest("tr").find("td").length > 1) {
            $(name).closest("td").removeClass("hidden");
        }
        else {
            $(name).closest("tr").removeClass("hidden");
        }
    }
    FormFunctions.ShowField = ShowField;
    function FieldRequired(name, required) {
        if (name === undefined || name === null || name === "") {
            throw "No name specified for function 'FormFunctions.FieldRequired'";
        }
        if (name.charAt(0) !== '#') {
            name = "#" + name;
        }
        if (required === undefined || required === null) {
            required = true;
        }
        required = !!required;
        if (required) {
            FormFunctions.ShowField(name);
        }
        if (required) {
            $("label" + name + "_label").parent().addClass("required");
        }
        else {
            $("label" + name + "_label").parent().removeClass("required");
        }
    }
    FormFunctions.FieldRequired = FieldRequired;
    function ClearField(name) {
        if (name === undefined || name === null || name === "") {
            throw "No name specified for function 'FormFunctions.HideField'";
        }
        if (name.charAt(0) !== '#') {
            name = "#" + name;
        }
        $(name).val(null);
        // clear lookup field values too, if it is a lookup
        FormFunctions.SetLookupField(name, null, null, null);
    }
    FormFunctions.ClearField = ClearField;
    function SetLookupField(fieldName, logicalName, id, displayName) {
        if (fieldName === undefined || fieldName === null || fieldName === "") {
            throw "No fieldname specified for function 'FormFunctions.SetLookupField'";
        }
        if (fieldName.charAt(0) !== '#') {
            fieldName = "#" + fieldName;
        }
        $(fieldName).attr("value", id);
        $(fieldName + "_name").attr("value", displayName);
        $(fieldName + "_entityname").attr("value", logicalName);
    }
    FormFunctions.SetLookupField = SetLookupField;
    function HideField(name, ignoreRequired) {
        if (name === undefined || name === null || name === "") {
            throw "No name specified for function 'FormFunctions.HideField'";
        }
        if (name.charAt(0) !== '#') {
            name = "#" + name;
        }
        ignoreRequired = !!ignoreRequired;
        // either hide the TR (when 1 child present) or just the TD (when more than 1 child present)
        if ($(name).closest("tr").find("td").length > 1) {
            $(name).closest("td").addClass("hidden");
        }
        else {
            $(name).closest("tr").addClass("hidden");
        }
        if (!ignoreRequired) {
            FormFunctions.FieldRequired(name, false);
        }
    }
    FormFunctions.HideField = HideField;
    function HideTableInSection(name) {
        var pageSection = $("[data-name='" + name + "']").parent();
        $(pageSection).find("table").hide();
    }
    FormFunctions.HideTableInSection = HideTableInSection;
    function GenerateRandomString() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    FormFunctions.GenerateRandomString = GenerateRandomString;
    function AppendIFrame(parentContainer, url, id, autoResize) {
        if (autoResize === undefined || autoResize == null) {
            autoResize = true;
        }
        if (id === undefined || id === null || id === "") {
            id = "r" + (new Date()).getTime();
        }
        var dfd = $.Deferred();
        parentContainer.append("<iframe id='" + id + "' src='" + url + "' style='width: 100%; height: 100px' frameBorder='0'></iframe>");
        if (autoResize) {
            $("iframe#" + id).on('load', function () {
                setInterval(function (el) {
                    $(el).height($(el).contents().outerHeight());
                }, 100, $(this));
                dfd.resolve();
            });
        }
        // Return an immutable promise object.
        // Clients can listen for its done or fail
        // callbacks but they can't resolve it themselves
        return dfd.promise();
    }
    FormFunctions.AppendIFrame = AppendIFrame;
    function PostMessageToIframe(id, message) {
        if ($("iframe#" + id).length > 0) {
            $("iframe#" + id)[0].contentWindow.postMessage(message, "*");
            return true;
        }
        return false;
    }
    FormFunctions.PostMessageToIframe = PostMessageToIframe;
    function SubscribeToWindowMessages(win, fun, _this) {
        // listen to updates from the web resource
        $(win).on("message onmessage", function (e) {
            var data = e.originalEvent.data;
            fun.call(_this, data);
        });
    }
    FormFunctions.SubscribeToWindowMessages = SubscribeToWindowMessages;
    function ExposeContent() {
        $('.unwrapMe').contents().unwrap();
        $('.unwrapMeLoadCompleted').remove();
    }
    FormFunctions.ExposeContent = ExposeContent;
    function AddNotificationTocladeNotificationsBar(message, alertClassType) {
        if ($(".cladenotificationbar").length > 0) {
            $(".cladenotificationbar").append('<div class="alert alert-' + alertClassType + '" role="alert">' + message + '</div>');
            $(".cladenotificationbar").removeClass("hidden");
            return true;
        }
        return false;
    }
    FormFunctions.AddNotificationTocladeNotificationsBar = AddNotificationTocladeNotificationsBar;
    function AddDismissableNotificationTocladeNotificationsBar(message, alertClassType) {
        if ($(".cladenotificationbar").length > 0) {
            $(".cladenotificationbar").append('<div class="alert alert-' + alertClassType + '" role="alert">' + message + '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>');
            $(".cladenotificationbar").removeClass("hidden");
            return true;
        }
        return false;
    }
    FormFunctions.AddDismissableNotificationTocladeNotificationsBar = AddDismissableNotificationTocladeNotificationsBar;
    function qs(key) {
        key = key.replace(/[*+?^$.\[\]{}()|\\\/]/g, "\\$&"); // escape RegEx meta chars
        var match = location.search.match(new RegExp("[?&]" + key + "=([^&]+)(&|$)"));
        return match && decodeURIComponent(match[1].replace(/\+/g, " "));
    }
    FormFunctions.qs = qs;
})(FormFunctions || (FormFunctions = {}));
//# sourceMappingURL=FormFunctions.js.map