// Generate Invoice PDFs and emails
// =============================================================================

// call the packages we need
var assert     = require('assert');
var crypto = require('crypto');
var request = require('request');
var async   = require('async');
var fs      = require('fs');

//var MailComposer = require("mailcomposer").MailComposer;
//var dots = require("dot").process({path: "./views", templateSettings: {strip: false}});

// CiviCRM
var config = {
  server: process.env.CIVICRM_SERVER,
  path: process.env.CIVICRM_PATH,
  key: process.env.CIVICRM_SITE_KEY,
  api_key: process.env.CIVICRM_API_KEY,
};

var crmAPI = require('./civicrm')(config);

var client_api = process.env.PPSAPI_URL;
var client_pdf = process.env.LATEX_URL;

// to access the API, the following hash needs to be generated
// sha1(secret + ":" + f1 + "/" + leftover).substring(0,20)
// e.g. http://localhost:8080/members/hash/blabla would result in
// sha1(secret:members/blabla).substring(0,20) only half of the hash is used

var invoice_secret = process.env.PPSAPI_INVOICESECRET;

function sha1(value) {
	var shasum = crypto.createHash('sha1');

	shasum.update(value);
	return shasum.digest('hex');
}

var map_communication_method = {
	'1':'phone',
	'2':'email',
	'3':'snailmail'
};

function is_snailmail(methods)
{
	for (var i in methods) {
		if (map_communication_method[methods[i]] == 'snailmail')
			return true;
	}

	return false;
}

var map_status = {
	'0':'unknown',
	'1':'new',
	'2':'pirate',
	'3':'grace',
	'4':'expired',
	'5':'pending',
	'6':'left',
	'7':'dead',
	'8':'excluded'	
}

var do_for_status = {
	'unknown':false,
	'new':false,
	'pirate':false,
	'grace':false,
	'expired':false,
	'pending':false,
	'left':false,
	'dead':false,
	'excluded':false
}

function set_output() {
	if (process.argv.length < 3) {
		console.log("No parameter found. Creating letters for new members");
		do_for_status['new'] = true;
	} else if (process.argv[2] == 'new') {
		console.log("Creating letters for new members");
		do_for_status['new'] = true;
	} else if (process.argv[2] == 'pending') {
		console.log("Creating letters for pending members");
		do_for_status['pending'] = true;
	} else if (process.argv[2] == 'expired') {
		console.log("Creating letters for expired members");
		do_for_status['expired'] = true;
	} else if (process.argv[2] == 'pirate') {
		console.log("Creating letters for pirate and grace members");
		do_for_status['pirate'] = true;
		do_for_status['grace'] = true;
	} else if (process.argv[2] == 'notpirate') {
		console.log("Creating letters for new, pending and expired members");
		do_for_status['new'] = true;
		do_for_status['pending'] = true;
		do_for_status['expired'] = true;
	} else if (process.argv[2] == 'all') {
		console.log("Creating letters for all members");
		do_for_status['new'] = true;
		do_for_status['pending'] = true;
		do_for_status['pirate'] = true;
		do_for_status['grace'] = true;
		do_for_status['expired'] = true;
	} else {
		console.log("State one of 'new', 'pending', 'expired', 'pirate', 'notpirate' or 'all'.");
		assert.fail(process.argv[2], 'new', "Parameter not understood", '=');
	}
}

function needs_invoice(status_id) {
	var status = map_status[status_id]
	return do_for_status[status];
}

var map_language = {
	'de_CH': 'de',
	'de_DE': 'de',
	'de_AT': 'de',
	'de_BE': 'de',
	'de_LI': 'de',
	'de_LU': 'de',
	'de': 'de',
	'fr_FR': 'fr',
	'fr_BE': 'fr',
	'fr_CA': 'fr',
	'fr_LU': 'fr', 
	'en_GB': 'en',
	'en_US': 'en',
	'en_AU': 'en',
	'en_CA': 'en',
	'en_NZ': 'en', 
	'it_IT': 'it',
	'it_CH': 'it'
};

function get_language(lang) {
	if (lang) {
		if (map_language[lang]) {
			return map_language[lang];
		} else {
			return 'en';
		}
	} else {
		return 'en';
	}
}

var map_invoice = {
	'de': 'texinvoiceletterde',
	'fr': 'texinvoiceletterfr',
	'it':'texinvoiceletterit',
	'en':'texinvoiceletteren'
};

var map_subject = {
	'de': 'Mitgliederbeitrag 2015',
	'fr': 'Cotisation 2015',
	'it': 'Quota 2015',
	'en': 'Membership Fee 2015',
};

var map_from = {
	'de': "Piratenpartei Schweiz <info@piratenpartei.ch>",
	'fr': "Parti Pirate Suisse <info@partipirate.ch>",
	'it': "Partito Pirata Svizzera <info@partitopirata.ch>",
	'en': "Pirate Party Switzerland <info@pirateparty.ch>",
};

var pdf_queue = async.queue(function (task, callback) {
	fs.mkdir(task.out_path, function(e) {
		request({method: 'POST', url: task.project_base + '/compile', json: true, body: task.compile_job},  function (error, response, body) {
			if (!error && response.statusCode == 200) {
				assert.equal(body.compile.status, 'success', "Compilation failed: " + JSON.stringify(body));
				request.get(task.project_base + '/output/output.pdf')
					.on('response', function (response) {
					})
					.pipe(fs.createWriteStream(task.out_path + task.out_file)
						.on('close', function () {
							async.nextTick(callback);
						})
					);
			} else {
				console.log("pdf error: " + error);
				async.nextTick(callback);
			}
		});
	});
}, 2);
 
function api_with_secret(secret, path1, path2) {
	return path1 + '/' + sha1(secret + ':' + path1+'/'+path2).substring(0,20) + '/' + path2;
}

function create_pdfs(offset, limit, callback) {
	crmAPI.get ('Membership', { 'options': { 'offset': offset, 'limit': limit }, 'membership_type_id': 'PPS', 'return':'contact_id,status_id' },
                function (membership_result) {
                        assert.equal(membership_result.is_error, 0, "API call failed: " + JSON.stringify(membership_result));

                        for (var i in membership_result.values) {
                                var membership = membership_result.values[i];
				
				if (needs_invoice(membership.status_id)) {
	        			crmAPI.get ('Contact', { 'id': membership.contact_id, 'return':'external_identifier,preferred_communication_method,preferred_language,first_name,last_name' },
        	                        	function (contact_result) {
                	                        	assert.equal(contact_result.is_error, 0, "API call failed: " + JSON.stringify(contact_result));
							if (contact_result.count > 0) {
								var contact = contact_result.values[0];
								var member_id = contact.external_identifier;

			                        	        if (is_snailmail(contact.preferred_communication_method)) {
                        	                        	        var lang = contact.preferred_language;
                                	                        	console.log(contact.external_identifier + " " + contact.first_name + " " + contact.last_name);
	                                	                        var template = map_invoice[get_language(lang)];
        	                                	                var compile_job = {
    "compile": {
       "options": {
            "compiler": "xelatex",
            "timeout": 40
        },
        "rootResourcePath": "main.tex",
        "resources": [{
            "path": "main.tex",
            "url": client_api + "/api/v1/" + api_with_secret(invoice_secret, 'letterman', member_id + '/'+ template),
        }, {
            "path": "esr.sty",
            "url": "http://127.0.0.1:81/static/inv/esr.sty"
        }, {
            "path": "esrpos.sty",
            "url": "http://127.0.0.1:81/static/inv/esrpos.sty"
        }, {
            "path": "orange-pay.png",
            "url": "http://127.0.0.1:81/static/inv/orange-pay.png"
        }, {
            "path": "sig-st.png",
            "url": "http://127.0.0.1:81/static/inv/sig-st.png"
        }, {
            "path": "sig-gs.png",
            "url": "http://127.0.0.1:81/static/inv/sig-gs.png"
        }]
    }
};
                        	                        	        var session_secret = process.env.PDFAPI_SESSIONSECRET;
                                	                        	var member_id_hash = sha1(session_secret + member_id);
	                                        	                var project_base = client_pdf + '/project/' + member_id_hash;
        	                                        	        var out_path = "/data/pdf/";
                	                                        	var out_file = member_id + ".pdf";
        	        	                                        pdf_queue.push({project_base: project_base, compile_job: compile_job, out_path: out_path, out_file: out_file, lang: lang}, function (err) {
                	        	                                	console.log("finished " + member_id);
                        	        	                	},function () {
                                	        	                	console.log("finished batch " + member_id);
                                        	        		});
								}
							}
						});
				}
			}

			if (callback)
				callback(membership_result.count);
		});
}

function invoke_recursive(offset, limit) {
        create_pdfs(offset, limit, function(count) {
                console.log("result get_membership: " + count);
                if (count == limit)
                        invoke_recursive(offset+limit, limit);
        });
};

set_output();
invoke_recursive(0, 100);

