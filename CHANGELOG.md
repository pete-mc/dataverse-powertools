# Change Log

All notable changes to the "dataverse-powertools" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 0.1.13

- Added lookup to dataverse to get form list to save having to enter the form id into the vscode dialog.
- Reworked the dataverse context. This is now a singleton class that is created when the extension is activated.  This will allow the context to be used by other parts of the extension. This will prevent the need for multiple requests to get auth tokens and will handle refreshing the token automatically.
- Added some more logging.

## 0.1.12

Added support to register form events for webresource classes.  This will allow you to register form events for webresources in the same way as you can for plugin steps.  To use this feature you need to select Add Form Registration when in a webresource class.  This will add a new property to the class called FormRegistration.  This property is a list of FormRegistration objects.  Each FormRegistration object has the following properties:

formId - The form id to register the event for.  This can be found in the form url in the maker portal.
event - The event to register for.  This can be one of the following value: onload, onsave.
excutionContext - Specifices whether to send the execution context to the webresource.  This can be one of the following values: true, false.
triggerId - The id of the event registration. Must be a unique GUID
function - The name of the function to call in the webresource.

Once you are ready to publish the events to dataverse you can use the Register Form Events command in the Dataverse PowerTools menu.  This will publish the events to dataverse and add the event registrations to the form.

## 0.1.11

Miscellaneous bug fixes.

## 0.1.10

- Added Earlybound Table and Action GUI to the Dataverse PowerTools menu.  This will allow you to select the tables and actions for spkl to generate into classes from the menu rather than editing the spkl.json manually.  This release includes the ability to select any available table from your dataverse environment, future releases will also allow this for actions. Currently action selection is limited to using the manual + button.
