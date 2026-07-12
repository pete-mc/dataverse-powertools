import * as fs from "fs";
import * as path from "path";
import { MigrationIo } from "./settingsMigrations";

/** The fs-backed MigrationIo production callers hand to migrateSettings,
 * rooted at the component folder that owns the settings file. */
export function fsMigrationIo(componentRoot: string): MigrationIo {
  return {
    readProjectFile(name) {
      try {
        return fs.readFileSync(path.join(componentRoot, name), "utf8");
      } catch {
        return undefined;
      }
    },
    writeProjectFile(name, content) {
      fs.writeFileSync(path.join(componentRoot, name), content);
    },
    projectFileExists(name) {
      return fs.existsSync(path.join(componentRoot, name));
    },
  };
}
