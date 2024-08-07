import { v4 as uuidv4 } from 'uuid';
import RedisClient from '../utils/redis';
import DBClient from '../utils/db';

const { ObjectId } = require('mongodb');
const fs = require('fs');
const Bull = require('bull');
const mime = require('mime-types');

class FilesController {
  static async postUpload(request, response) {
    const fileQueue = new Bull('fileQueue');

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

    fileQueue.add({
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

  static async getShow(request, response) {
    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const RedisToken = await RedisClient.get(`auth_${token}`);
    if (!RedisToken) return response.status(401).send({ error: 'Unauthorized' });

    const user = await DBClient.db.collection('users').findOne({ _id: ObjectId(RedisToken) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });

    const fileId = request.params.id || '';
    const file = await DBClient.db.collection('files').findOne({ _id: ObjectId(fileId) });
    if (!file) return response.status(404).send({ error: 'Not found' });

    return response.send({
      id: file._id,
      usedId: file.usedId,
      name: file.name,
      type: file.type,
      isPublic: file.filePublic,
      parentId: file.parentId,
    });
  }

  static async getIndex(request, response) {
    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const RedisToken = await RedisClient.get(`auth_${token}`);
    if (!RedisToken) return response.status(401).send({ error: 'Unauthorized' });

    const user = await DBClient.db.collection('users').findOne({ _id: ObjectId(RedisToken) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });

    const parentId = request.query.parentId || 0;
    const page = request.query.page || 0;

    const aggregateMatch = { $and: [{ parentId }] };
    const aggregateData = [{ $match: aggregateMatch }, { $skip: page * 20 }, { $limit: 20 }];

    const files = await DBClient.db.collection('files').aggregate(aggregateData);
    const filesArr = [];
    await files.forEach((item) => {
      const fileData = {
        id: item._id,
        userId: item.userId,
        name: item.name,
        type: item.type,
        isPublic: item.isPublic,
        parentId: item.parentId,
      };
      filesArr.push(fileData);
    });
    return response.send(filesArr);
  }

  static async putPublish(request, response) {
    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const RedisToken = await RedisClient.get(`auth_${token}`);
    if (!RedisToken) return response.status(401).send({ error: 'Unauthorized' });

    const user = await DBClient.db.collection('users').findOne({ _id: ObjectId(RedisToken) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });

    const fileId = request.params.id || '';
    let file = await DBClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: user._id });
    if (!file) return response.status(404).send({ error: 'Not found' });

    await DBClient.db.collection('files').updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: true } });
    file = await DBClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: user._Id });

    return response.send({
      id: file._id,
      usedId: file.usedId,
      name: file.name,
      type: file.type,
      isPublic: file.filePublic,
      parentId: file.parentId,
    });
  }

  static async putUnpublish(request, response) {
    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const RedisToken = await RedisClient.get(`auth_${token}`);
    if (!RedisToken) return response.status(401).send({ error: 'Unauthorized' });

    const user = await DBClient.db.collection('users').findOne({ _id: ObjectId(RedisToken) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });

    const fileId = request.params.id || '';
    let file = await DBClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: user._id });
    if (!file) return response.status(404).send({ error: 'Not found' });

    await DBClient.db.collection('files').updateOne({ _id: ObjectId(fileId) }, { $set: { isPublic: false } });
    file = await DBClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: user._Id });

    return response.send({
      id: file._id,
      usedId: file.usedId,
      name: file.name,
      type: file.type,
      isPublic: file.filePublic,
      parentId: file.parentId,
    });
  }

  static async getFile(request, response) {
    const idFile = request.params.id || '';
    const size = request.query.size || 0;

    const fileDocument = await DBClient.db.collection('files').findOne({ _id: ObjectId(idFile) });
    if (!fileDocument) return response.status(404).send({ error: 'Not found' });

    const { isPublic } = fileDocument;
    const { userId } = fileDocument;
    const { type } = fileDocument;

    let user = null;
    let owner = false;

    const token = request.header('X-Token') || null;
    if (token) {
      const redisToken = await RedisClient.get(`auth_${token}`);
      if (redisToken) {
        user = await DBClient.db.collection('users').findOne({ _id: ObjectId(redisToken) });
        if (user) owner = user._id.toString() === userId.toString();
      }
    }

    if (!isPublic && !owner) return response.status(404).send({ error: 'Not found' });
    if (['folder'].includes(type)) return response.status(400).send({ error: 'A folder doesn\'t have content' });

    const realPath = size === 0 ? fileDocument.localPath : `${fileDocument.localPath}_${size}`;

    try {
      const dataFile = fs.readFileSync(realPath);
      const mimeType = mime.contentType(fileDocument.name);
      response.setHeader('Content-Type', mimeType);
      return response.send(dataFile);
    } catch (error) {
      return response.status(404).send({ error: 'Not found' });
    }
  }
}

module.exports = FilesController;
