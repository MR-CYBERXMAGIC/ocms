// Shared add-problem validation used by manager.html and create-contest.html
(function () {

  const PLATFORM_PATTERNS = {
    'CSES':       /cses\.fi\/problemset\/task\/\d+/i,
    'CodeChef':   /codechef\.com\/problems\/[A-Za-z0-9_]+/i,
    'HackerRank': /hackerrank\.com\/challenges\/[a-z0-9-]+/i,
    'USACO':      /usaco\.org\/index\.php.*?(prob=|cpid=)\w+/i,
  };

  const PLATFORM_EXAMPLES = {
    'CSES':       'https://cses.fi/problemset/task/1068',
    'CodeChef':   'https://www.codechef.com/problems/FLOW001',
    'HackerRank': 'https://www.hackerrank.com/challenges/solve-me-first',
    'USACO':      'https://usaco.org/index.php?page=viewproblem2&cpid=570',
  };

  // Returns an error string, or null if valid.
  window.validateProblemURL = function (platform, url) {
    if (!platform) return 'Please select a platform.';
    if (!url)      return 'Please enter the problem URL.';
    const pattern = PLATFORM_PATTERNS[platform];
    if (pattern && !pattern.test(url)) {
      return `URL does not look like a valid ${platform} problem link. Example: ${PLATFORM_EXAMPLES[platform]}`;
    }
    return null;
  };

})();
