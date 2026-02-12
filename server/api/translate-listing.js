const OpenAI = require('openai');
const { handleError, getSdk } = require('../api-util/sdk');

const SUPPORTED_LANGUAGES = ['en', 'nl', 'es', 'fr', 'de'];
const EXCLUDED_PUBLIC_DATA_KEYS = new Set([
  'listingType',
  'transactionProcessAlias',
  'unitType',
  'categoryLevel1',
  'categoryLevel2',
  'categoryLevel3',
]);
const DEFAULT_TRANSLATABLE_PUBLIC_TEXT_KEYS = new Set([
  'attraction_name',
  'attraction_type',
  'manufacturer',
]);

const languageAliases = {
  en: 'en',
  eng: 'en',
  english: 'en',
  nl: 'nl',
  nld: 'nl',
  dutch: 'nl',
  nederlands: 'nl',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  espanol: 'es',
  espana: 'es',
  fr: 'fr',
  fra: 'fr',
  french: 'fr',
  francais: 'fr',
  de: 'de',
  deu: 'de',
  german: 'de',
  deutsch: 'de',
};

const normalizeLanguage = value => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return languageAliases[normalized] || null;
};

const getTranslatableTextFieldKeys = listingFieldsConfig => {
  if (!Array.isArray(listingFieldsConfig)) {
    return DEFAULT_TRANSLATABLE_PUBLIC_TEXT_KEYS;
  }

  const keys = listingFieldsConfig.reduce((acc, fieldConfig) => {
    const { key, schemaType, scope = 'public' } = fieldConfig || {};
    if (
      scope === 'public' &&
      schemaType === 'text' &&
      typeof key === 'string' &&
      key
    ) {
      acc.add(key);
    }
    return acc;
  }, new Set());

  // Keep a safe fallback if request doesn't provide any valid config items.
  return keys.size > 0 ? keys : DEFAULT_TRANSLATABLE_PUBLIC_TEXT_KEYS;
};

const getTranslatablePublicData = (publicData, translatableTextFieldKeys) => {
  if (
    !publicData ||
    typeof publicData !== 'object' ||
    Array.isArray(publicData)
  ) {
    return {};
  }

  return Object.entries(publicData).reduce((acc, [key, value]) => {
    if (
      EXCLUDED_PUBLIC_DATA_KEYS.has(key) ||
      !translatableTextFieldKeys.has(key)
    ) {
      return acc;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      acc[key] = value;
    }
    return acc;
  }, {});
};

const buildPromptPayload = ({ title, description, publicData }) => {
  return {
    targetLanguages: SUPPORTED_LANGUAGES,
    input: {
      title: typeof title === 'string' ? title : '',
      description: typeof description === 'string' ? description : '',
      publicData,
    },
    outputSchema: {
      detectedLanguage: 'en|nl|es|fr|de',
      translations:
        '{ [languageCode]: { title: string, description: string, publicData: { [key]: string } } }',
    },
    rules: [
      'Detect source language from all provided text.',
      'Translate to all target languages except detectedLanguage.',
      'Keep publicData keys exactly the same.',
      'Return only valid JSON, no markdown.',
    ],
  };
};

const normalizeTranslations = ({
  detectedLanguage,
  rawTranslations,
  originalFields,
}) => {
  const output = {};
  const languages = SUPPORTED_LANGUAGES;

  languages.forEach(lang => {
    const langTranslation =
      lang === detectedLanguage
        ? originalFields
        : rawTranslations?.[lang] || {};
    const translatedPublicData = {};
    Object.keys(originalFields.publicData).forEach(key => {
      const translatedValue = langTranslation?.publicData?.[key];
      translatedPublicData[key] =
        typeof translatedValue === 'string' && translatedValue.trim().length > 0
          ? translatedValue
          : originalFields.publicData[key];
    });

    output[`title_${lang}`] =
      typeof langTranslation?.title === 'string' &&
      langTranslation.title.trim().length > 0
        ? langTranslation.title
        : originalFields.title;

    output[`description_${lang}`] =
      typeof langTranslation?.description === 'string' &&
      langTranslation.description.trim().length > 0
        ? langTranslation.description
        : originalFields.description;

    Object.keys(translatedPublicData).forEach(key => {
      output[`${key}_${lang}`] = translatedPublicData[key];
    });
  });

  return output;
};

const processTranslations = async ({ originalFields }) => {
  const apiKey = process.env.OPEN_AI_SECRET_KEY;
  if (!apiKey) {
    const error = new Error('Missing Credentials.');
    error.content = req.body;
    throw error;
  }

  const openai = new OpenAI({ apiKey });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a translation engine. Detect source language and translate listing fields. Output valid JSON only.',
      },
      {
        role: 'user',
        content: JSON.stringify(buildPromptPayload(originalFields)),
      },
    ],
  });

  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error('Missing Content.');
    error.content = req.body;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const error = new Error('Invalid JSON.');
    error.content = content;
    throw error;
  }

  return parsed;
};

module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);

    const userResponse = await sdk.currentUser.show({ expand: true });
    if (!userResponse) {
      const error = new Error('Unauthorized.');
      error.content = req.body;
      throw error;
    }

    const {
      listingData = {},
      listingFieldsConfig = [],
      editListingMode = ['createDraft'],
      queryParams = {},
    } = req.body || {};
    const { title = '', description = '', publicData = {}, id: listingId } =
      listingData || {};
    const translatableTextFieldKeys = getTranslatableTextFieldKeys(
      listingFieldsConfig
    );
    const translatablePublicData = getTranslatablePublicData(
      publicData,
      translatableTextFieldKeys
    );

    const originalFields = {
      title: typeof title === 'string' ? title : '',
      description: typeof description === 'string' ? description : '',
      publicData: translatablePublicData,
    };

    const hasTranslatableText =
      originalFields.title.trim().length > 0 ||
      originalFields.description.trim().length > 0 ||
      Object.keys(originalFields.publicData).length > 0;

    if (!hasTranslatableText) {
      const error = new Error(
        'No translatable text found in title, description, or publicData.'
      );
      error.content = req.body;
      throw error;
    }

    const parsedTranslations = await processTranslations({ originalFields });

    const detectedLanguage =
      normalizeLanguage(parsedTranslations?.detectedLanguage) ||
      userResponse.data.data.attributes.profile.publicData.language ||
      'en';
    const translatedFields = normalizeTranslations({
      detectedLanguage,
      rawTranslations: parsedTranslations?.translations || {},
      originalFields,
    });

    const isCreateDraft = editListingMode.includes('createDraft');
    const createOrUpdate = isCreateDraft
      ? sdk.ownListings.createDraft
      : sdk.ownListings.update;
    const { translations: _legacyTranslations, ...existingPublicData } =
      listingData?.publicData || {};

    if (!isCreateDraft && !listingId) {
      const error = new Error('Missing listingId for update mode.');
      error.content = req.body;
      throw error;
    }

    const titleInEnglish =
      detectedLanguage === 'en'
        ? originalFields.title
        : translatedFields.title_en;
    const descriptionInEnglish =
      detectedLanguage === 'en'
        ? originalFields.description
        : translatedFields.description_en;

    const response = await createOrUpdate(
      {
        ...listingData,
        title: titleInEnglish,
        description: descriptionInEnglish,
        publicData: {
          ...existingPublicData,
          ...translatedFields,
          detectedListingLanguage: detectedLanguage,
        },
      },
      queryParams
    );

    const { status, statusText, data } = response;

    return res.status(status).send({
      status,
      statusText,
      data,
    });
  } catch (error) {
    handleError(res, error);
  }
};
