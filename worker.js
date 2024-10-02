import { writeFile } from 'fs';
import { promisify } from 'util';
import Queue from 'bull/lib/queue';
import imageThumbnail from 'image-thumbnail';
import mongoDBCore from 'mongodb/lib/core';
import DBClient from './utils/db';

const asyncWriteFile = promisify(writeFile);
const fileQueue = new Queue('thumbnail generation');

const createThumbnail = async (fileLoc, dims) => {
  const thumbBuf = await imageThumbnail(fileLoc, { width: dims });
  console.log(`Creating file: ${fileLoc}, size: ${dims}`);
  return asyncWriteFile(`${fileLoc}_${dims}`, thumbBuf);
};

fileQueue.process(async (task, done) => {
  const fileId = task.data.fileId || null;
  const userId = task.data.userId || null;

  if (!fileId) {
    throw new Error('Missing fileId');
  }
  if (!userId) {
    throw new Error('Missing userId');
  }
  console.log('Processing', task.data.name || '');
  const fileRecord = await (await DBClient.filesCollection())
    .findOne({
      _id: new mongoDBCore.BSON.ObjectId(fileId),
      userId: new mongoDBCore.BSON.ObjectId(userId),
    });
  if (!fileRecord) {
    throw new Error('File not found');
  }
  const thumbDims = [500, 250, 100];
  Promise.all(thumbDims.map((dims) => createThumbnail(fileRecord.localPath, dims)))
    .then(() => {
      done();
    });
});
