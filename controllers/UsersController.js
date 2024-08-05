import sha1 from 'sha1';
import RedisClient from '../utils/redis';
import DBClient from '../utils/db';

const { ObjectId } = require('mongodb');

class UsersController {
  static async postNew(request, response) {
    const userEmail = request.body.email;
    if (!userEmail) return response.status(400).send({ error: 'Missing email' });

    const userPass = request.body.password;
    if (!userPass) return response.status(400).send({ error: 'Missing password' });

    const oldEmail = await DBClient.db.collection('users').findOne({ email: userEmail });
    if (oldEmail) return response.status(400).send({ error: 'Already exist' });

    const shapass = sha1(userPass);
    const user = await DBClient.db.collection('users').insertOne({ email: userEmail, password: shapass });

    return response.status(201).send({ id: user.insertID, email: userEmail });
  }

  static async getMe(request, response) {
    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const redisToken = await RedisClient.get(`auth_${token}`);
    if (!redisToken) return response.status(401).send({ error: 'Unauthorized' });

    const user = await DBClient.db.collection('users').findOne({ _id: ObjectId(redisToken) });
    if (!user) return response.status(401).send({ error: 'Unauthorized' });
    delete user.password;

    return response.status(200).send({ _id: user._id, email: user.email });
  }
}

module.exports = UsersController;
