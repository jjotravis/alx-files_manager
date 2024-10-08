import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import RedisClient from '../utils/redis';
import DBClient from '../utils/db';

class AuthController {
  static async getConnect(request, response) {
    const auth = request.header('Authorization') || null;
    if (!auth) return response.status(401).send({ error: 'Unauthorized' });

    const buff = Buffer.from(auth.replace('Basic ', ''), 'base64');
    const credentials = {
      email: buff.toString('utf-8').split(':')[0],
      password: buff.toString('utf-8').split(':')[1],
    };

    if (!credentials.email || !credentials.password) return response.status(401).send({ error: 'Unauthorized' });

    // const hashpassword = sha1(credentials.password);
    credentials.password = sha1(credentials.password);

    const user = await DBClient.db.collection('users').findOne(credentials);
    if (!user) return response.status(401).send({ error: 'Unauthorized' });

    const token = uuidv4();
    const key = `auth_${token}`;
    await RedisClient.set(key, user._id.toString(), 86400);

    return response.status(200).send({ token });
  }

  static async getDisconnect(request, response) {
    const token = request.header('X-Token') || null;
    if (!token) return response.status(401).send({ error: 'Unauthorized' });

    const redisToken = await RedisClient.get(`auth_${token}`);
    if (!redisToken) return response.status(401).send({ error: 'Unauthorized' });

    await RedisClient.del(`auth_${token}`);
    return response.status(204).send();
  }
}

module.exports = AuthController;
