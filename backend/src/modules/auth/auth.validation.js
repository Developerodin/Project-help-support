import Joi from 'joi';

const password = Joi.string().min(8).max(128).required();

export const loginSchema = {
  body: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),
};

export const acceptInviteSchema = {
  body: Joi.object({ token: Joi.string().required(), password }),
};

export const forgotPasswordSchema = {
  body: Joi.object({ email: Joi.string().email().required() }),
};

export const resetPasswordSchema = {
  body: Joi.object({ token: Joi.string().required(), password }),
};
