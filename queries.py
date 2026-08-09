QUERY_PRESETS = {
    "Find user ID": {
        "query": """
query FindUser($searchTerm: String $first: Int) {
    users(searchTerm: $searchTerm first: $first) {
    nodes {
      id
      firstName
      lastName
      callSign
      contact {
        email
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }

  }
}
""".strip(),
        "variables": {
            "searchTerm": "",
            "first": 10,
        },
    },

    "User availability": {
        "query": """
query UserAvailability(
  $id: String
  $from: DateTime
  $to: DateTime
  $first: Int
) {
  user(id: $id) {
    id
    firstName
    lastName

    availabilities(
      from: $from
      to: $to
      first: $first
    ) {
      nodes {
        startsAt
        endsAt
        unavailable
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
""".strip(),
        "variables": {
            "id": "",
            "from": "2026-08-07T00:00:00+02:00",
            "to": "2026-08-14T23:59:59+02:00",
            "first": 100,
        },
    },
}

USERS_BY_ROLE_QUERY = """
query UsersByRole(
  $roles: [UserRoleEnum!]
  $first: Int
  $after: String
) {
  users(
    roles: $roles
    first: $first
    after: $after
  ) {
    nodes {
      id
      firstName
      lastName
      callSign
    }

    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""


USER_AVAILABILITY_QUERY = """
query UserAvailability(
  $id: String
  $from: DateTime
  $to: DateTime
  $first: Int
  $after: String
) {
  user(id: $id) {
    availabilities(
      from: $from
      to: $to
      first: $first
      after: $after
    ) {
      nodes {
        startsAt
        endsAt
        unavailable
      }

      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""
