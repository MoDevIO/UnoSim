export const shouldSendSimulationEndMessage = (
  compileFailed: boolean,
): boolean => {
  return !compileFailed;
};
