const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const mime = require('mime');
const fileUpload = require('express-fileupload');

const port = 4444;
const basePath = path.resolve('../../Documents/File Browser Test');

const filterVisibleFiles = filePath => !filePath.startsWith('.');

const isDir = async filePath => (await fs.lstat(filePath)).isDirectory()

const getFullPath = subPath => path.join(basePath, subPath)

const readDirFiles = async (subPath, depth) => {
    const dirPath = getFullPath(subPath);
    if (!await isDir(dirPath)) {
        return null;
    }

    const files = (await fs.readdir(dirPath)).filter(filterVisibleFiles);
    const stats = await Promise.all(files.map((fPath) => fs.lstat(path.join(dirPath, fPath))))

    const filesWithStats = files
        .map((filename, i) => {
            const isDir = stats[i].isDirectory();
            const isFile = stats[i].isFile();
            if (!isDir && !isFile) {
                return null;
            }

            return {
                path: path.join(subPath, filename),
                isDir,
                mimeType: mime.getType(path.join(dirPath, filename)),
            };
        })
        .filter(x => x);

    return { files: filesWithStats, parentPath: subPath, depth };
};

const sanitizePath = (path) => unescape(path.replace(/\.\./, ''));

const getPathQueryParam = req => sanitizePath(req.query.path || '/')

// CORS
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "http://localhost:8080");
    res.header("Access-Control-Allow-Methods", "DELETE,POST");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.use(fileUpload());

app.get(
    '/directories',
    async function (req, res, next) {
        try {
            if (req.query.withParents === 'true') {
                return next();
            }

            const requestedPath = getPathQueryParam(req);
            const dir = await readDirFiles(requestedPath, requestedPath.split(path.sep).length - 1);

            if (!dir) {
                res.status(404).end('Not found');
                return;
            }

            res.status(200).end(JSON.stringify(dir));
        } catch (e) {
            console.log("ERROR while fetching one dir!", e);
        }
    },
    async function (req, res, next) {
        try {
            const requestedPath = getPathQueryParam(req);

            const pathParts = requestedPath === path.sep ? [path.sep] : requestedPath.split(path.sep);
            const subPaths = pathParts.map((_, index) => (pathParts.slice(0, index + 1).join(path.sep)) || '/');

            const dirsOfFiles = await Promise.all(subPaths.map(readDirFiles));

            res.status(200).end(JSON.stringify(dirsOfFiles.filter(Boolean)));
        } catch (e) {
            console.log("ERROR while fetching dir with parents!", e);
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