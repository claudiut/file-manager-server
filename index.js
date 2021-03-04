const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const mime = require('mime');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');

const port = 4444;
const basePath = path.resolve('../../Documents/FileManagerTest');

// Middleware
// CORS
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "http://localhost:8080");
    res.header("Access-Control-Allow-Methods", "DELETE,POST,PUT");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});
app.use(fileUpload());
app.use(bodyParser.json());

// Helpers
const filterVisibleFiles = filePath => !filePath.startsWith('.');

const isDir = async filePath => (await fs.lstat(filePath)).isDirectory()

const getFullPath = subPath => path.join(basePath, subPath)

const getFileOrDirInfo = (subPath) => {
    const diskPath = getFullPath(subPath);
    return fs.lstat(diskPath).then(stats => {
        const isDir = stats.isDirectory();
        const isFile = stats.isFile();
        if (!isDir && !isFile) {
            return null;
        }

        return {
            path: subPath,
            isDir,
            mimeType: mime.getType(diskPath),
        };
    });
};

const readDirFiles = async (subDirPath, depth) => {
    const fullDirPath = getFullPath(subDirPath);
    if (!await isDir(fullDirPath)) {
        return null;
    }

    const files = (await fs.readdir(fullDirPath)).filter(filterVisibleFiles);

    const filesWithStats = await Promise.all(
        files.map((filename) => {
            return getFileOrDirInfo(path.join(subDirPath, filename));
        })
    );

    return { files: filesWithStats.filter(x => x), parentPath: subDirPath, depth };
};

const sanitizePath = (path) => unescape(path.replace(/\.{2,}\//, ''));

const getPathQueryParam = req => sanitizePath(req.query.path || '/')

const getDirectoryDepth = (subPath) => subPath === path.sep ? 0 : subPath.split(path.sep).length - 1;

const getDirectoryAndParents = async function (req, res) {
    try {
        const requestedPath = getPathQueryParam(req);

        const pathParts = requestedPath === path.sep ? [path.sep] : requestedPath.split(path.sep);

        const topParentPath = req.query.withParentsTopParent ? sanitizePath(req.query.withParentsTopParent) : '/';
        
        // fetch directories up until a specific parent
        const subPaths = pathParts
            .map((_, index) => (pathParts.slice(0, index + 1).join(path.sep)) || '/')
            .filter((p) => p.startsWith(topParentPath))

        const topParentDepth = getDirectoryDepth(topParentPath);
        const dirsOfFiles = await Promise.all(subPaths.map((subPath, i) => readDirFiles(subPath, topParentDepth + i)));

        res.status(200).end(JSON.stringify(dirsOfFiles.filter(Boolean)));
    } catch (e) {
        console.log("ERROR while fetching dir with parents!", e);
    }
};

// Routes
app.get(
    '/directories',
    async function (req, res, next) {
        try {
            if (req.query.withParents === 'true') {
                return getDirectoryAndParents(req, res);
            }

            const requestedPath = getPathQueryParam(req);
            const dir = await readDirFiles(requestedPath, getDirectoryDepth(requestedPath));

            if (!dir) {
                res.status(404).end('Not found');
                return;
            }

            res.status(200).end(JSON.stringify(dir));
        } catch (e) {
            console.log("ERROR while fetching one dir!", e);
        }
    }
);

app.post('/directories', async (req, res) => {
    const relativeDir = getPathQueryParam(req);

    await fs.mkdir(getFullPath(relativeDir));

    res.status(200).end('OK');
});

const deleteFileHandler = (deleterFn) => async (req, res) => {
    const relativePath = getPathQueryParam(req);

    try {
        await deleterFn(getFullPath(relativePath));
        res.status(200).end('OK');
    } catch (e) {
        res.status(500).end('Internal Server Error');
    }
};

app.delete('/directories', deleteFileHandler(f => fs.rmdir(f, {recursive: true})));

app.delete('/files', deleteFileHandler(fs.unlink));

const updateFile = async (req, res) => {
    let { path } = req.body;
    const { path: newPath } = req.body.updates;

    // perform the requested updates, if any
    if (newPath) {
        await fs.rename(getFullPath(path), getFullPath(newPath));
        path = newPath;
    }

    res.setHeader('Content-Type', 'application/json');
    const fileInfo = await getFileOrDirInfo(path);
    res.status(200).end(JSON.stringify(fileInfo));
};
app.put('/directories', updateFile);
app.put('/files', updateFile);

app.get('/files', async (req, res) => {
    const requestedPath = getPathQueryParam(req);
    const absoluteFilePath = getFullPath(requestedPath);
    const isFile = !(await isDir(absoluteFilePath));

    if (!isFile) {
        res.status(404).end('Not found');
        return;
    }

    res.setHeader('Content-Type', mime.getType(absoluteFilePath));
    res.setHeader('Content-Disposition', 'inline');
    res.status(200).sendFile(absoluteFilePath);
});

app.post('/files', async (req, res) => {
    const uploadPath = req.body.path ? getFullPath(sanitizePath(req.body.path)) : basePath;

    if (!req.files.files || req.files.files.length === 0) {
        res.status(400).end('Bad request');
    }

    const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];

    await Promise.all(
        files.map((file) => {
            const filePath = path.join(uploadPath, file.name);
            return new Promise((resolve, reject) => {
                file.mv(filePath, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                })
            })
        })
    );

    res.status(201).end('OK');
});

app.listen(port, () => console.log(`FS test listening at http://localhost:${port}`))