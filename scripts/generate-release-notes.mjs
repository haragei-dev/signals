import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const workspaceRoot = process.cwd();
const artifactsDir = path.join(workspaceRoot, '.release-artifacts');
const manifestPath = path.join(artifactsDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest.length === 0) {
    throw new Error('No packed artifacts were found. Run pnpm release:pack first.');
}

const releaseVersion = manifest[0].version;
const releaseTag = `v${releaseVersion}`;
const repoUrl = await getRepositoryUrl(
    path.join(workspaceRoot, manifest[0].packageDir, 'package.json'),
);
const previousTag = await getPreviousTag(releaseTag, releaseVersion);

const changelogSections = [];
const downloadRows = [];

for (const entry of manifest) {
    const changelogPath = path.join(workspaceRoot, entry.packageDir, 'CHANGELOG.md');
    const changelog = await readFile(changelogPath, 'utf8');
    const changelogSection = extractVersionSection(changelog, releaseVersion);
    const tarballPath = path.join(workspaceRoot, entry.tarball);
    const tarballName = path.basename(entry.tarball);
    const checksum = await sha256(tarballPath);

    changelogSections.push(
        `## ${entry.name}\n\n${changelogSection ?? '_No changelog entry found for this release._'}`,
    );
    downloadRows.push(`| \`${entry.name}\` (${tarballName}) | \`${checksum}\` |`);
}

const downloadsIntro =
    manifest.length === 1
        ? 'The published package tarball and its sha256 checksum are:'
        : 'The published package tarballs and their sha256 checksums are:';
const downloadsTable = ['| Package | sha256 |', '| --- | --- |', ...downloadRows].join('\n');

const notes = [
    ...changelogSections,
    '### Downloads',
    downloadsIntro,
    downloadsTable,
    previousTag
        ? `**Full Changelog**: ${repoUrl}/compare/${previousTag}...${releaseTag}`
        : `**Full Changelog**: ${repoUrl}/commits/${releaseTag}`,
].join('\n\n');

await writeFile(path.join(artifactsDir, 'release-notes.md'), `${notes}\n`, 'utf8');

async function getRepositoryUrl(packageJsonPath) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    const repository = packageJson.repository;
    const rawUrl = typeof repository === 'string' ? repository : repository?.url;

    if (!rawUrl) {
        throw new Error(`No repository URL was found in ${packageJsonPath}`);
    }

    return rawUrl.replace(/^git\+/, '').replace(/\.git$/, '');
}

async function getPreviousTag(currentTag, currentVersion) {
    const { stdout } = await run('git', ['tag', '--list', 'v*', '--sort=-version:refname'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
    });

    const tags = stdout
        .split('\n')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .filter((tag) => tag !== currentTag);

    const previousTag = tags[0] ?? null;

    if (!previousTag) {
        return null;
    }

    return compareVersions(previousTag.slice(1), currentVersion) < 0 ? previousTag : null;
}

function extractVersionSection(changelog, version) {
    const headingPattern = new RegExp(
        `^##\\s+\\[?${escapeRegex(version)}\\]?(?:\\s+-\\s+.*)?$`,
        'm',
    );
    const headingMatch = changelog.match(headingPattern);

    if (!headingMatch || headingMatch.index == null) {
        return null;
    }

    const sectionStart = headingMatch.index + headingMatch[0].length;
    const remainder = changelog.slice(sectionStart);
    const nextHeadingMatch = remainder.match(/^##\s+/m);
    const sectionEnd =
        nextHeadingMatch?.index != null ? sectionStart + nextHeadingMatch.index : changelog.length;

    return changelog.slice(sectionStart, sectionEnd).trim();
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function sha256(filePath) {
    const content = await readFile(filePath);

    return createHash('sha256').update(content).digest('hex');
}

function compareVersions(left, right) {
    const leftParts = left.split('.').map((part) => Number(part));
    const rightParts = right.split('.').map((part) => Number(part));
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const leftValue = leftParts[index] ?? 0;
        const rightValue = rightParts[index] ?? 0;

        if (leftValue !== rightValue) {
            return leftValue - rightValue;
        }
    }

    return 0;
}
