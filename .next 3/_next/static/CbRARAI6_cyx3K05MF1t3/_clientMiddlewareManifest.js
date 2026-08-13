self.__MIDDLEWARE_MATCHERS = [
  {
    "regexp": "^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/|favicon\\.ico|robots\\.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$",
    "originalSource": "/((?!_next/|favicon\\.ico|robots\\.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()