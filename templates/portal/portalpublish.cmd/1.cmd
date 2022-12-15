SET PORTALRELEASEPATH=.\portalpublish\portal-dev\web-files
IF NOT EXIST "%PORTALRELEASEPATH%" MKDIR %PORTALRELEASEPATH% 
PUSHD ".\scripts\compiledjs"
   FOR /r %%a in (*.js) DO (
     COPY /Y "%%a" "..\..\%PORTALRELEASEPATH%"
   )
   POPD

PUSHD ".\styles\scss"
   FOR /r %%a in (*.css) DO (
     COPY /Y "%%a" "..\..\%PORTALRELEASEPATH%"
   )
   POPD