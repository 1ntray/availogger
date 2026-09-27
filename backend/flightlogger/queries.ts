// The fields and pagination arguments come from the legacy Streamlit queries and
// FlightLogger's public GraphQL reference. The nested availability selection avoids
// one network subrequest per instructor on Cloudflare's free tier.
// Omitting the ID returns the user scoped by the authenticated API key.
export const CURRENT_USER_QUERY = `query CurrentUser { user { id } }`;

export const INSTRUCTORS_QUERY = `
query Instructors($first: Int, $after: String) {
  users(roles: [FLIGHT_INSTRUCTOR], first: $first, after: $after) {
    nodes { id firstName lastName callSign }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const INSTRUCTORS_WITH_AVAILABILITY_QUERY = `
query InstructorsWithAvailability($first: Int, $after: String, $from: DateTime, $to: DateTime) {
  users(roles: [FLIGHT_INSTRUCTOR], first: $first, after: $after) {
    nodes {
      id firstName lastName callSign
      availabilities(from: $from, to: $to, first: 50) {
        nodes { startsAt endsAt unavailable }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const MORE_AVAILABILITY_QUERY = `
query MoreAvailability($id: String, $from: DateTime, $to: DateTime, $after: String) {
  user(id: $id) {
    availabilities(from: $from, to: $to, first: 50, after: $after) {
      nodes { startsAt endsAt unavailable }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
export const CURRENT_USER_PROFILE_QUERY = `query CurrentUserProfile { user { id firstName lastName } }`;

export const DUTY_OPS_QUERY = `
  query DutyOps($from: DateTime!, $to: DateTime!, $all: Boolean!, $after: String) {
    bookings(from: $from, to: $to, all: $all, overlap: true, subtypes: [MEETING], first: 50, after: $after) {
      nodes {
        __typename
        ... on MeetingBooking {
          id startsAt endsAt status externalReference
          classroom { id name }
          participants { id firstName lastName }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const FLYVASK_QUERY = `
  query Flyvask($from: DateTime!, $to: DateTime!, $all: Boolean!, $after: String) {
    bookings(from: $from, to: $to, all: $all, overlap: true, subtypes: [MEETING], first: 50, after: $after) {
      nodes {
        __typename
        ... on MeetingBooking {
          id startsAt endsAt status comment externalReference
          classroom { id name }
          participants { id firstName lastName }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;
