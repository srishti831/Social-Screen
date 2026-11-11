import User from '../models/User.js';

export const findUserByEmail = (email) => User.findOne({ email });
export const findUserById = (id) => User.findById(id);
export const findUserByGoogleId = (googleId) => User.findOne({ googleId });

/** Never expose hashes or tokens. */
export const toPublicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  emailVerified: Boolean(user.emailVerified),
  hasPassword: Boolean(user.password),
});

export const createUser = ({ name, email, passwordHash = null, googleId = null, emailVerified = false }) =>
  User.create({ name, email, password: passwordHash, googleId: googleId || undefined, emailVerified });
