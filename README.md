# Dataverse Powertools

[See system requirements for this tool in the wiki.](https://github.com/pete-mc/dataverse-powertools/wiki/Requirements)

Dataverse Powertools contains tools and templates to assist with the development of Dataverse and Dynamics 365 projects. It enables developers to perform various actions such as:

-	Creating, updating, and deploying web resources with TypeScript  
-	Creating and managing custom C# plugins and PCF fields and datasets  
-	Creating and managing Portal assets such as templates and web pages  
-	Generating and updating Azure Functions, Logic Apps, and more  
-	Testing code and test cases on Dynamics forms directly in vs code before deployment  

It provides a user-friendly interface in the Visual Studio Code editor, allowing developers to perform all these actions without leaving the development environment. The tool provides a range of templates, snippets, and other resources to help developers speed up their development process.

In summary, this tool is an all-in-one solution that streamlines the development process and helps developers to efficiently build and manage Dynamics 365 and Power Platform solutions in Visual Studio Code.

## Webresources:

Developers can create web resources such as HTML, TypeScript (JavaScript), and CSS files using templates and advanced features like syntax highlighting, code snippets, and code completion. They can also test their web resources locally using a built-in web server, and deploy them to the Power Platform directly from within the editor.

Once the project is initialised for web resources, you will see these buttons from the Dataverse Tools extension tab:
<img src="https://github.com/pete-mc/dataverse-powertools/raw/main/media/Webresources.png" width="280" height="290"/>

 
-	Restore Dependencies (should be done on project initialisation) -> this should be implemented the first time using the project to connect to Dynamics  
-	Create Web Resource Class -> this creates a new typescript (.ts) class with a built-in template for updating Dynamics 365 app forms  
-	Generate Typings -> updates the fields on each table found when you code. This should be applied for any changes in the Dynamics app solution  
-	Build/Build & Deploy Web Resources -> this will build your code to debug any errors and update the file. Build & Deploy will deploy your changes into your Dynamics app to test changes before committing your code to GitHub  
  
Other notes – test cases can be created to test code on the Dynamics app forms inside of vs code itself without needing to deploy to the app  

## Plugins:

For plugin development, the tool provides a robust set of templates and code snippets to speed up the development process. It also includes a debugger to help developers identify and fix issues quickly. The tool can deploy plugins to the Power Platform and manage their registration and versioning.

Once the project is initialised for plugins, you will see these buttons from the Dataverse Tools extension tab:
<img src="https://github.com/pete-mc/dataverse-powertools/raw/main/media/Plugins.png" width="280" height="290"/>
 
-	Restore Dependencies (should be done on project initialisation) -> this should be implemented the first time using the project to connect to Dynamics  
-	Generate Early Bound -> updates the fields on each table found when you code. This should be applied for any changes in the Dynamics app solution  
-	Create Plugin Class -> creates a new C# (.cs) file with a built-in template for plugins updating the Dynamics 365 database functionality and fields directly  
-	Create Workflow Class -> creates a new C# (.cs) file with a built-in template for code activities to add custom code actions to workflows  
-	Build/Build & Deploy Plugins -> this will build your code to debug any errors and update the file. Build & Deploy will deploy your changes into your Dynamics app to test changes before committing your code to GitHub  

# Coming Soon
## PCF Fields/Dataset:

With PCF controls, developers can create custom controls for PowerApps and Dynamics 365 using modern web technologies like React, Angular, and TypeScript. The tool provides templates and advanced features for PCF control development, including debugging, packaging, and deployment to the Power Platform.  
  
<!-- Once the project is initialised for pcf fields or datasets, you will see these buttons from the Dataverse Tools extension tab: -->

## Portals:

The tool also provides features for managing Portals, including creating and managing Portal assets such as templates, content snippets, and web pages. It also includes advanced features for customizing and extending the Portal's functionality using HTML, CSS, TypeScript, Angular and more coding languages.  
  
<!-- Once the project is initialised for portals, you will see these buttons from the Dataverse Tools extension tab: -->
