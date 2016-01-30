FROM node:5.3-onbuild

# Overwrite these with actual passwords,keys and URLs
ENV PPSAPI_PAYSECRET abcdef
ENV PPSAPI_BASEURL http://api.local.piratenpartei.ch/api/v1
ENV PPSAPI_PAYLINKURL http://pay.local.piratenpartei.ch

ENV CIVICRM_SERVER http://wordpress.local.piratenpartei.ch
ENV CIVICRM_PATH /wp-content/plugins/civicrm/civicrm/extern/rest.php/extern/rest.php
ENV CIVICRM_SITE_KEY secret
ENV CIVICRM_API_KEY secret

