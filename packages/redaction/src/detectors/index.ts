import type { DetectorInfo } from '../index';
import { envAssignment } from './assignment';
import { highEntropy } from './entropy';
import {
  anthropicKey,
  authorizationHeader,
  awsAccessKeyId,
  awsSecretAccessKey,
  githubToken,
  gitlabToken,
  googleApiKey,
  jwt,
  npmToken,
  openaiKey,
  pypiToken,
  sendgridKey,
  shopifyToken,
  slackToken,
  slackWebhook,
  stripeKey,
  twilioKey,
  urlCredentials,
} from './patterns';
import { privateKey } from './private-key';
import type { StringDetector } from './types';

/**
 * String detectors in run order: whole blocks first, then specific vendor
 * shapes, then context-based detectors, then the entropy fallback.
 */
export const STRING_DETECTORS: readonly StringDetector[] = [
  privateKey,
  awsAccessKeyId,
  awsSecretAccessKey,
  githubToken,
  gitlabToken,
  slackToken,
  slackWebhook,
  stripeKey,
  anthropicKey,
  openaiKey,
  googleApiKey,
  npmToken,
  pypiToken,
  sendgridKey,
  twilioKey,
  shopifyToken,
  jwt,
  urlCredentials,
  authorizationHeader,
  envAssignment,
  highEntropy,
];

/** Detector id for values of secret-named keys in `redactJson`. */
export const SECRET_FIELD_ID = 'secret-field';

/** Applied by `redactJson` after the string detectors. */
export const SECRET_FIELD_INFO: DetectorInfo = {
  id: SECRET_FIELD_ID,
  description: 'Whole string value of a secret-named JSON key (redactJson only)',
  kind: 'structure',
};

/** Public detector metadata, in run order. */
export const DETECTOR_INFOS: readonly DetectorInfo[] = Object.freeze(
  [...STRING_DETECTORS.map((d) => d.info), SECRET_FIELD_INFO].map((info) => Object.freeze(info)),
);
