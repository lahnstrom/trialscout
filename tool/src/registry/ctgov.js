import { DateTime } from "luxon";
import { log } from "../utils/utils.js";
import fs from "fs";
import { REGISTRY_TYPES } from "./utils.js";

export const fetchRegistration = async (trialId) => {
  const url = `https://clinicaltrials.gov/api/v2/studies/${trialId}`;
  const res = await fetch(url, {
    method: "GET",
    accept: "application/json",
  });
  return await res.json();
};

const parseRegistrationDate = (dateStruct) => {
  if (!dateStruct) {
    return null;
  }
  const date = DateTime.fromISO(dateStruct.date);
  return date;
};

const parseSponsorCollaborators = (sponsorCollaboratorsModule) => {
  const investigatorFullName =
    sponsorCollaboratorsModule?.responsibleParty?.investigatorFullName;
  const investigatorType = sponsorCollaboratorsModule?.responsibleParty?.type;
  const leadSponsorName = sponsorCollaboratorsModule?.leadSponsor?.name;
  const collaboratorNames = sponsorCollaboratorsModule?.collaborators?.map(
    (col) => col.name
  );

  return {
    investigatorFullName,
    leadSponsorName,
    collaboratorNames,
    investigatorType,
  };
};

const parseArmsInterventionsModule = (armsInterventionsModule) => {
  const arms = armsInterventionsModule?.armGroups;
  const interventions = armsInterventionsModule?.interventions;
  return {
    arms,
    interventions,
  };
};

const parseConditionsModule = (conditionsModule) => {
  const conditions = conditionsModule?.conditions;
  const keywords = conditionsModule?.keywords;

  return {
    conditions,
    keywords,
  };
};

const parseOutcomesModule = (outcomesModule) => {
  const primaryOutcomes = outcomesModule?.primaryOutcomes;
  const secondaryOutcomes = outcomesModule?.secondaryOutcomes;
  return {
    primaryOutcomes,
    secondaryOutcomes,
  };
};

const parseEligibilityModule = (eligibilityModule) => {
  const eligibilityCriteria = eligibilityModule?.eligibilityCriteria;
  const healthyVolunteers = eligibilityModule?.healthyVolunteers;
  const minimumAge = eligibilityModule?.minimumAge;
  const sex = eligibilityModule?.sex;

  return {
    eligibilityCriteria,
    healthyVolunteers,
    minimumAge,
    sex,
  };
};

export const parseRegistration = (registrationRaw) => {
  const identificationModule =
    registrationRaw?.protocolSection?.identificationModule;
  const descriptionModule = registrationRaw?.protocolSection?.descriptionModule;
  const statusModule = registrationRaw?.protocolSection?.statusModule;
  const sponsorCollaboratorsModule =
    registrationRaw?.protocolSection?.sponsorCollaboratorsModule;
  const referencesModule = registrationRaw?.protocolSection?.referencesModule;
  const designModule = registrationRaw?.protocolSection?.designModule;
  const armsInterventionsModule =
    registrationRaw?.protocolSection?.armsInterventionsModule;
  const conditionsModule = registrationRaw?.protocolSection?.conditionsModule;
  const eligibilityModule = registrationRaw?.protocolSection?.eligibilityModule;
  const outcomesModule = registrationRaw?.protocolSection?.outcomesModule;
  const principalInvestigators =
    registrationRaw?.protocolSection?.contactsLocationsModule?.overallOfficials?.map(
      (official) => official.name
    ) || [];

  const hasResults = registrationRaw?.hasResults;
  const briefTitle = identificationModule?.briefTitle;
  const officialTitle = identificationModule?.officialTitle;
  const organization = identificationModule?.organization;
  const trialId = identificationModule?.nctId;
  const studyType = designModule?.studyType;
  const enrollmentInfo = designModule?.enrollmentInfo;
  const briefSummary = descriptionModule?.briefSummary;
  const detailedDescription = descriptionModule?.detailedDescription;
  const overallStatus = statusModule?.overallStatus;
  const startDate = parseRegistrationDate(statusModule?.startDateStruct);
  const completionDate = parseRegistrationDate(
    statusModule?.completionDateStruct
  );

  const {
    investigatorFullName,
    leadSponsorName,
    collaboratorNames,
    investigatorType,
  } = parseSponsorCollaborators(sponsorCollaboratorsModule);

  const { interventions, arms } = parseArmsInterventionsModule(
    armsInterventionsModule
  );

  const { conditions, keywords } = parseConditionsModule(conditionsModule);

  const { primaryOutcomes, secondaryOutcomes } =
    parseOutcomesModule(outcomesModule);

  const { eligibilityCriteria, healthyVolunteers, minimumAge, sex } =
    parseEligibilityModule(eligibilityModule);

  const references = referencesModule?.references || [];

  const registration = {
    trialId,
    registryType: REGISTRY_TYPES.CTGOV,
    hasResults,
    briefTitle,
    officialTitle,
    organization,
    studyType,
    enrollmentInfo,
    briefSummary,
    detailedDescription,
    overallStatus,
    startDate,
    completionDate,
    investigatorFullName,
    investigatorType,
    leadSponsorName,
    collaboratorNames,
    references,
    interventions,
    arms,
    conditions,
    keywords,
    eligibilityCriteria,
    healthyVolunteers,
    minimumAge,
    sex,
    primaryOutcomes,
    secondaryOutcomes,
    principalInvestigators,
  };

  return registration;
};

export const checkSummaryResults = (registration) => {
  if (!registration) {
    throw new Error(
      `checkSummaryResults expecting registration, got ${registration}`
    );
  }
  return registration.hasResults;
};

export const fetchRegistrationFs = (trialId, dir) => {
  const filePath = `${dir}/${trialId}.json`;
  log(`Reading registration from file ${filePath}`);
  const file = fs.readFileSync(filePath);
  return JSON.parse(file);
};
