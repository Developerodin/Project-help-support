import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from './helpers/memoryDb.js';
import toJSON from '../toJSON.plugin.js';

withMemoryDb();

const schema = new mongoose.Schema({
  name: String,
  secret: { type: String, private: true },
  nested: { inner: { type: String, private: true }, shown: String },
});
schema.plugin(toJSON);
const Widget = mongoose.model('ToJsonWidget', schema);

test('maps _id to id and removes __v', async () => {
  const doc = await Widget.create({ name: 'thing' });
  const json = doc.toJSON();
  assert.equal(json.id, doc._id.toString());
  assert.equal(json._id, undefined);
  assert.equal(json.__v, undefined);
  assert.equal(json.name, 'thing');
});

test('strips paths marked private, including nested ones', async () => {
  const doc = await Widget.create({
    name: 'thing', secret: 'hunter2', nested: { inner: 'hidden', shown: 'visible' },
  });
  const json = doc.toJSON();
  assert.equal(json.secret, undefined);
  assert.equal(json.nested.inner, undefined);
  assert.equal(json.nested.shown, 'visible');
});
