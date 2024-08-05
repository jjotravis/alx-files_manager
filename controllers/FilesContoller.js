import { v4 as uuidv4 } from 'uuid';
import RedisClient from '../utils/redis';
import DBClient from '../utils/db';

const { ObjectId } = require('mongodb');
const fs = require('fs');
const Bull = require('bull');

class FilesController {
  static async postUpload(request, response) {
    const Queue = new Bull('Queue');

    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const redisToken = await RedisClient.get(`auth_${token}`);
    if (!redisToken) return response.status(401).send({ error: 'Unauthorized' });

    const user = await DBClient.db.collection('users').findOne({ _id: ObjectId(redisToken) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });

    const fileName = request.body.name;
    if (!fileName) return response.status(400).send({ error: 'Missing name' });

    const fileType = request.body.type;
    if (!fileType || !['folder', 'file', 'image'].includes(fileType)) return response.status(400).send({ error: 'Missing type' });

    const fileData = request.body.data;
    if (!fileData && ['file', 'image'].includes(fileType)) return response.status(400).send({ error: 'Missing data' });

    const filePublic = request.body.isPublic || false;
    let fileparentId = request.body.parentId || 0;
    fileparentId = fileparentId === '0' ? 0 : fileparentId;

    if (fileparentId !== 0) {
      const parentFile = await DBClient.db.collection('files').findOne({ _id: ObjectId(fileparentId) });
      if (!parentFile) return response.status(400).send({ error: 'Parent not found' });
      if (!['folder'].includes(parentFile.type)) return response.status(400).send({ error: 'Parent is not a folder' });
    }

    const fileDataDb = {
      userId: user._id,
      name: fileName,
      type: fileType,
      isPublic: filePublic,
      parentId: fileparentId,
    };

    if (['folder'].includes(fileType)) {
      await DBClient.db.collection('files').insertOne(fileDataDb);
      return response.status(201).send({
        id: fileDataDb._id,
        userId: fileDataDb.userId,
        name: fileDataDb.fileName,
        type: fileDataDb.fileType,
        isPublic: fileDataDb.filePublic,
        parentId: fileDataDb.parentId,
      });
    }

    const pathDir = process.env.FOLDER_PATH || '/tmp/files_manager';
    const fileId = uuidv4();

    const buff = Buffer.from(fileData, 'base64');
    const pathFile = `${pathDir}/${fileId}`;

    await fs.mkdir(pathDir, { recursive: true }, (error) => {
      if (error) return response.status(400).send({ error: error.message });
      return true;
    });

    await fs.writeFile(pathFile, buff, (error) => {
      if (error) return response.status(400).send({ error: error.message });
      return true;
    });

    fileDataDb.localPath = pathFile;
    await DBClient.db.collection('files').insertOne(fileDataDb);

    Queue.add({
      userId: fileDataDb.userId,
      fileId: fileDataDb._id,
    });

    return response.status(200).send({
      id: fileDataDb._id,
      userId: fileDataDb.userId,
      name: fileDataDb.fileName,
      type: fileDataDb.fileType,
      isPublic: fileDataDb.filePublic,
      parentId: fileDataDb.parentId,
    });
  }
}

module.exports = FilesController;
