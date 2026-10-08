import { BuildResult } from './types/GodotExport';
import path from 'path';
import * as fs from 'fs';
import * as io from '@actions/io';
import { exec } from '@actions/exec';
import sanitize from 'sanitize-filename';
import {
  ARCHIVE_ROOT_FOLDER,
  GODOT_ARCHIVE_PATH,
  GODOT_PROJECT_PATH,
  RELATIVE_EXPORT_PATH,
  USE_PRESET_EXPORT_PATH,
} from './constants';
import * as core from '@actions/core';

async function zipBuildResults(buildResults: BuildResult[], version: string | null): Promise<void> {
  core.startGroup('⚒️ Zipping binaries');
  const promises: Promise<void>[] = [];
  for (const buildResult of buildResults) {
    promises.push(
      (async function () {
        await zipBuildResult(buildResult, version);
        core.info(`📦 Zipped ${buildResult.preset.name} to ${buildResult.archivePath}`);
      })(),
    );
  }
  await Promise.all(promises);
  core.endGroup();
}

async function zipBuildResult(buildResult: BuildResult, version: string | null): Promise<void> {
  await io.mkdirP(GODOT_ARCHIVE_PATH);

  const versionSuffix = version ? `_${sanitize(version)}` : '';
  const zipPath = path.join(GODOT_ARCHIVE_PATH, `${buildResult.sanitizedName}${versionSuffix}.zip`);

  const isMac = buildResult.preset.platform.toLowerCase() === 'mac osx';
  const endsInDotApp = !!buildResult.preset.export_path.match('.app$');

  // in case mac doesn't export a zip, move the file
  if (isMac && !endsInDotApp) {
    const baseName = path.basename(buildResult.preset.export_path);
    const macPath = path.join(buildResult.directory, baseName);
    await io.cp(macPath, zipPath);
  }

  // 7zip automatically overwrites files that are in the way
  await exec('7z', ['a', zipPath, `${buildResult.directory}${ARCHIVE_ROOT_FOLDER ? '' : '/*'}`]);

  buildResult.archivePath = zipPath;
}

/**
 * Appends the version to each export's output files in-place, preserving the pairing between an
 * executable and files that share its basename (e.g. "game.exe" + "game.pck" -> "game_1.2.0.exe" +
 * "game_1.2.0.pck"). Used when `archive_output` is not set, since there is no zip name to version.
 */
function renameBuildFilesWithVersion(buildResults: BuildResult[], version: string): void {
  core.startGroup('🏷️ Appending version to export files');
  const sanitizedVersion = sanitize(version);

  for (const buildResult of buildResults) {
    const stem = path.basename(buildResult.preset.export_path).split('.')[0];
    const entries = fs.readdirSync(buildResult.directory);

    for (const entry of entries) {
      if (entry.split('.')[0] !== stem) {
        continue;
      }

      const oldPath = path.join(buildResult.directory, entry);
      const newEntry = `${stem}_${sanitizedVersion}${entry.slice(stem.length)}`;
      const newPath = path.join(buildResult.directory, newEntry);

      fs.renameSync(oldPath, newPath);
      core.info(`Renamed ${oldPath} to ${newPath}`);

      if (path.basename(buildResult.executablePath) === entry) {
        buildResult.executablePath = newPath;
      }
    }
  }

  core.endGroup();
}

async function moveBuildsToExportDirectory(buildResults: BuildResult[], moveArchived?: boolean): Promise<void> {
  core.startGroup(`➡️ Moving exports`);
  const promises: Promise<void>[] = [];
  for (const buildResult of buildResults) {
    const fullExportPath = path.resolve(
      USE_PRESET_EXPORT_PATH
        ? path.join(GODOT_PROJECT_PATH, path.dirname(buildResult.preset.export_path))
        : RELATIVE_EXPORT_PATH,
    );

    await io.mkdirP(fullExportPath);

    let promise: Promise<void>;
    if (moveArchived) {
      if (!buildResult.archivePath) {
        core.warning('Attempted to move export output that was not archived. Skipping');
        continue;
      }
      const newArchivePath = path.join(fullExportPath, path.basename(buildResult.archivePath));
      core.info(`Copying ${buildResult.archivePath} to ${newArchivePath}`);
      promise = io.cp(buildResult.archivePath, newArchivePath);
      buildResult.archivePath = newArchivePath;
    } else {
      core.info(`Copying ${buildResult.directory} to ${fullExportPath}`);
      promise = io.cp(buildResult.directory, fullExportPath, { recursive: true });
      buildResult.directory = path.join(fullExportPath, path.basename(buildResult.directory));
      buildResult.executablePath = path.join(buildResult.directory, path.basename(buildResult.executablePath));
    }

    promises.push(promise);
  }

  await Promise.all(promises);
  core.endGroup();
}

export { zipBuildResults, renameBuildFilesWithVersion, moveBuildsToExportDirectory };
