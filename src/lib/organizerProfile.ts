type OrganizerContact = {
  firstName?: string;
  lastName?: string;
  phone?: string;
};

export function hasContactInfo(
  user: OrganizerContact | null | undefined,
): boolean {
  if (!user) return false;
  return Boolean(
    user.firstName?.trim() && user.lastName?.trim() && user.phone?.trim(),
  );
}
