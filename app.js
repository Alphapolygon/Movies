const API_KEY = '3bbf380371a2169bd25b710058646650';
const BASE_API_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w200';
const ORIGINAL_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original';
const FILMOGRAPHY_REQUEST_DELAY = 1000;
const CREDITS_PER_PAGE = 10;
let currentSearchType = 'movie';
let userRegion = 'US';
let filmographyRequestTimer;
let apiCache = { genres: {}, credits: {} };
const movieInput = document.getElementById('movieInput');
const suggestionsList = document.getElementById('suggestions');
const searchForm = document.getElementById('searchForm');
searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    searchContent();
});
const resultsContainer = document.getElementById('resultsContainer');
const loader = document.getElementById('loader');


  
function setupTypeButtons() {
    const buttons = document.querySelectorAll('.search-type-button');
	
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            buttons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            currentSearchType = button.dataset.type;
           // searchContent();
        });
    });
}

async function detectUserRegion() {
    const cachedRegion = localStorage.getItem('userRegions'); // More consistent key name
    if (cachedRegion) {
        userRegion = cachedRegion;
        console.log(`Using cached region: ${userRegion}`);
        return userRegion;
    }

    try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) {
            throw new Error(`Failed to fetch region: ${response.status} ${response.statusText}`); // More informative error
        }
        const data = await response.json();
        userRegion = data.country_code;
        console.log(`Detected region: ${userRegion}`);
        localStorage.setItem('userRegion', userRegion); // More consistent key name
        return userRegion;
    } catch (error) {
        console.error('Error detecting user region:', error);
        userRegion = 'US';
        return userRegion;
    }
}

// Improved fetchData with full URL caching
async function fetchData(url) {
    if (apiCache[url]) {
        return apiCache[url];
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText} for URL: ${url}`);
        }
        const data = await response.json();
        apiCache[url] = data;
        return data;
    } catch (error) {
        console.error("Error fetching data:", error);
        // Display a more user-friendly error message in the UI if possible
        return null; // Important: Return null to handle errors gracefully
    }
}

// Reusable function for handling item/person clicks
async function handleItemOrPersonClick(name, searchTypes, isMovie) {
	
	const type = isMovie ? 'movie' : 'tv';
	
    movieInput.value = name;
    const buttons = document.querySelectorAll('.search-type-button');
    buttons.forEach(btn => btn.classList.remove('active'));
	if(isMovie){
		currentSearchType = 'movie';
		searchType.value = 'movie';
	}else{
		currentSearchType = 'tv';
		searchType.value = 'tv';
	}
	
    const targetButton = document.querySelector(`.search-type-button[data-type="${searchType}"]`);
    if (targetButton) {
        targetButton.classList.add('active');
       // currentSearchType = searchTypes;
    }	
    await searchContent();
}

searchType.addEventListener('change', () => {
    currentSearchType = searchType.value;
   
});

// ... (getMovieSuggestions, detectUserRegion, setupTypeButtons remain mostly the same)

async function searchContent() {
    await detectUserRegion();
    const movieName = movieInput.value.trim();
    if (!movieName) {
        alert("Please enter a movie or TV show name.");
        return;
    }

    try {
        showLoader();
        let results;
        switch (currentSearchType) {
            case 'movie':
                results = await searchItems('movie', movieName);
                break;
            case 'tv':
                results = await searchItems('tv', movieName);
                break;
            case 'actor':
                const actors = await searchActors(movieName);
                if (actors && actors.length > 0) {
                    displayActorResults(actors);
                    return;
                } else {
                    alert("No actors found.");
                    return;
                }
            case 'director': // New case for director search
                const directors = await searchDirectors(movieName);
                if (directors && directors.length > 0) {
                    displayDirectorResults(directors);
                    return;
                } else {
                    alert("No directors found.");
                    return;
                }
            default:
                return;
        }
        if (results) {
            displayResults(results, currentSearchType === 'movie');
        } else {
            alert("Item not found. Please check the spelling and try again.");
        }
    } catch (error) {
        console.error('Error:', error);
        alert("An error occurred. Please try again.");
    } finally {
        hideLoader();
    }
}

async function searchDirectors(directorName) {
    const url = `${BASE_API_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(directorName)}`;
    try {
        const data = await fetchData(url);
        if (data && data.results) {
            // Filter results to only include people with known for department directing
            return data.results.filter(person => person.known_for_department === 'Directing');
        }
        return null;
    } catch (error) {
        console.error("Error searching directors:", error);
        return null;
    }
}

async function searchItems(type, query) {
    const searchId = await getItemId(type, query);
    if (!searchId) {
        alert("Item not found. Please check the spelling and try again.");
        return null;
    }
    const similarItems = await getSimilarItems(type, searchId);
    const searchedItem = await getItemData(type, searchId);
    if (!searchedItem) return null;

    const providers = await getWatchProviders(searchId, type);
    searchedItem.watch = getWatchData(providers);

    const similarItemsWithProviders = await Promise.all(similarItems.map(async (item) => {
        const providers = await getWatchProviders(item.id, item.media_type);
        return { ...item, watch: getWatchData(providers) };
    }));
    return { searchedItem, similarItems: similarItemsWithProviders };
}

async function getItemId(type, query) {
    const url = `${BASE_API_URL}/search/${type}?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
    const data = await fetchData(url);
    return data?.results?.[0]?.id || null;
}

async function getSimilarItems(type, itemId) {
    const url = `${BASE_API_URL}/${type}/${itemId}/recommendations?api_key=${API_KEY}&page=1`;
    return (await fetchData(url))?.results || [];
}

async function getItemData(type, itemId) {
    const url = `${BASE_API_URL}/${type}/${itemId}?api_key=${API_KEY}`;
    return await fetchData(url);
}

async function getWatchProviders(itemId, type) {
    const url = `${BASE_API_URL}/${type}/${itemId}/watch/providers?api_key=${API_KEY}`;
    return (await fetchData(url))?.results;
}

function getWatchData(providers) {
    const regionData = providers && providers[userRegion];
    return {
        link: regionData?.link,
        flatrate: regionData?.flatrate,
    };
}

async function searchActors(actorName) {
    const url = `${BASE_API_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(actorName)}`;
    return (await fetchData(url))?.results || null;
}

async function fetchAndDisplayPopularMovies() {
    const url = `${BASE_API_URL}/discover/movie?api_key=${API_KEY}&sort_by=popularity.desc&page=1`;

    try {
        const data = await fetchData(url);
        if (!data || !data.results) {
          console.error("No popular movies data received.");
          return;
        }
        // Add isPopular property and CAP to 10
        const popularMovies = data.results.slice(0, 10).map(movie => ({ ...movie, isPopular: true }));

        const popularMoviesWithProviders = await Promise.all(popularMovies.map(async (movie) => {
          const providers = await getWatchProviders(movie.id, 'movie');
          return {...movie, watch: getWatchData(providers)};
        }));

        displayPopular(popularMoviesWithProviders, true);
    } catch (error) {
        console.error("Error fetching popular movies:", error);
    } finally {
        hideLoader();
    }
}

async function displayPopular(movies, isMovie = true) {
	await  detectUserRegion();
    resultsContainer.innerHTML = ''; // Clear previous results

    movies.forEach(movie => {
		if (isMovie) {
			displayItem(movie, true, resultsContainer, true);
		} else {
			displayItem(movie, false, resultsContainer, true);
		}
        
    });
}

async function displayDirectorResults(directors) {
    resultsContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (const director of directors) {
        const directorDiv = document.createElement('div');
        directorDiv.classList.add('movieItem');

        const img = new Image();
        img.onload = () => {
            img.classList.remove('loading');
            img.classList.add('loaded');
        };
        img.onerror = () => {
            img.src = 'placeholder.jpg';
            img.alt = "Image could not be loaded";
            img.classList.remove('loading');
            img.classList.add('loaded');
        };

        img.dataset.src = director.profile_path ? `${IMAGE_BASE_URL}${director.profile_path}` : 'placeholder.jpg';
        img.alt = director.name;
        img.classList.add('loading');
        //img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

        directorDiv.appendChild(img);

        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('movieDetails');

        const nameHeading = document.createElement('h2');
        nameHeading.textContent = director.name;
        detailsDiv.appendChild(nameHeading);

        const filmographyButton = document.createElement('button');
        filmographyButton.textContent = 'Filmography';
        filmographyButton.classList.add('filmography-button');
        filmographyButton.addEventListener('click', async () => {
            if (filmographyRequestTimer) {
                clearTimeout(filmographyRequestTimer);
            }

            filmographyRequestTimer = setTimeout(async () => {
                filmographyRequestTimer = null;
                 await displayActorFilmography(director.id, director.name, true); // isDirector = true for directors
            }, FILMOGRAPHY_REQUEST_DELAY);
        });
        detailsDiv.appendChild(filmographyButton);

        directorDiv.appendChild(detailsDiv);
        fragment.appendChild(directorDiv);
    }

    resultsContainer.appendChild(fragment);
    requestAnimationFrame(lazyLoadImages);
}

const topRatedButton = document.getElementById('topRatedButton');
const topRatedTVShowsButton = document.getElementById('topRatedTVShowsButton');
let currentTopRatedPage = 1;
let totalTopRatedPages = 10;

topRatedTVShowsButton.addEventListener('click', () => {
    currentSearchType = 'tv';
    currentTopRatedPage = 1;
    resultsContainer.innerHTML = '';
    loadTopRatedMovies(false);
    //Deactivate other buttons
    const buttons = document.querySelectorAll('.topRatedbutton');
    buttons.forEach(btn => btn.classList.remove('active'));
    topRatedTVShowsButton.classList.add('active')
});

topRatedButton.addEventListener('click', () => {
    currentSearchType = 'movies';
    currentTopRatedPage = 1;
    resultsContainer.innerHTML = '';
    loadTopRatedMovies(true);
    //Deactivate other buttons
    const buttons = document.querySelectorAll('.topRatedbuttonn');
    buttons.forEach(btn => btn.classList.remove('active'));
    topRatedButton.classList.add('active')
});


async function loadTopRatedMovies(isMovie = true, currentPage = 1) {
    showLoader();

    let url = '';
    if (isMovie) {
        url = `${BASE_API_URL}/movie/top_rated?api_key=${API_KEY}&page=${currentPage}`;
    } else {
        url = `${BASE_API_URL}/tv/top_rated?api_key=${API_KEY}&page=${currentPage}`;
    }

    try {
        const data = await fetchData(url);

        if (data && data.results && data.results.length > 0) {
            totalTopRatedPages = data.total_pages;

            const popularMovies = data.results.map(movie => ({ ...movie, isPopular: true }));

            const popularMoviesWithProviders = await Promise.all(popularMovies.map(async (movie) => {
                try {
                    const providers = await getWatchProviders(movie.id, isMovie ? 'movie' : 'tv');
                    return { ...movie, watch: getWatchData(providers) };
                } catch (error) {
                    console.warn(`Error fetching watch providers for ${movie.title || movie.name}:`, error);
                    return { ...movie, watch: {} };
                }
            }));

            const validMovies = popularMoviesWithProviders.filter(movie => movie.watch);

            if (validMovies.length > 0) {
                displayTopRatedResults(validMovies, isMovie, currentPage, data.total_pages); // Pass total_pages
            } else {
                resultsContainer.innerHTML = '<p>No results found with watch provider information.</p>';
            }
        } else {
            resultsContainer.innerHTML = '<p>No top rated movies found.</p>';
        }
    } catch (error) {
        console.error('Error fetching top rated movies:', error);
        resultsContainer.innerHTML = '<p>Error fetching top rated movies.</p>';
    } finally {
        hideLoader();
    }
}


async function displayResults(results, isMovie) {
    resultsContainer.innerHTML = '';

    if (!results) {
        alert("No results to display.");
        return;
    }

    const { searchedItem, similarItems } = results;

    if (searchedItem) {
        displayItem(searchedItem, isMovie, resultsContainer, true);
        await delay(1000); // Delay before showing similar items
    }

    if (similarItems && similarItems.length > 0) {
        const separatorRow = document.createElement('div');
        separatorRow.classList.add('separator-row');
        separatorRow.textContent = `People who watched ${searchedItem.title || searchedItem.name} also watched:`;
        resultsContainer.appendChild(separatorRow);

        similarItems.forEach(item => {
            displayItem(item, item.media_type === 'movie', resultsContainer, false);
        });
    }
}

async function displayItem(item, isMovie, container, isMainItem, isFromFilmography = false) {
    if (!isMainItem && !isFromFilmography && (!item.watch || !item.watch.flatrate || item.watch.flatrate.length === 0)) {
        return; // Don't display if no streaming providers are available (unless it's the main item or from filmography)
    }

    const movieElement = document.createElement('div');
    movieElement.classList.add('movieItem');

    // Use DocumentFragment for better performance
    const fragment = document.createDocumentFragment();

    const imageContainer = document.createElement('div');
    imageContainer.classList.add('image-container');
    const imgLink = document.createElement('a');
    imgLink.href = '#';
	console.log(`handleItemOrPersonClick: ${isMovie ? 'movie' : 'tv'}`);
    imgLink.addEventListener('click', () => handleItemOrPersonClick(item.title || item.name, isMovie ? 'movie' : 'tv', isMovie));

    const img = new Image();
    img.onload = () => {
        img.classList.remove('loading'); // Remove loading class when loaded
        img.classList.add('loaded');
    };
    img.onerror = () => {
        img.src = 'placeholder.jpg';
        img.alt = "Image could not be loaded";
        img.classList.remove('loading'); // Remove loading class even on error
        img.classList.add('loaded'); // Add loaded class in case of error to prevent further attempts
    };
    img.src = item.poster_path ? `${IMAGE_BASE_URL}${item.poster_path}` : 'placeholder.jpg';
    img.alt = item.title || item.name;
    img.classList.add('loading'); // Add loading class initially

    imgLink.appendChild(img);
    imageContainer.appendChild(imgLink);
    fragment.appendChild(imageContainer);

    const detailsContainer = document.createElement('div');
    detailsContainer.classList.add('movieDetails');
    detailsContainer.style.display = 'grid';
    detailsContainer.style.gridTemplateColumns = '1fr 1fr';
    detailsContainer.style.gap = '5px';

    const column1 = document.createElement('div');
    const column2 = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = item.title || item.name;
    column1.appendChild(title);

    let runtimeText = "";

	if (isMovie) {
        if (item && item.runtime !== undefined && item.runtime !== null) { // Check if item and runtime exist and are not null
            runtimeText = item.runtime + " min";
        }
    } else {
        if (item && item.episode_run_time && item.episode_run_time.length > 0) { // Check if item, episode_run_time and length exist
            runtimeText = item.episode_run_time[0] + " min/ep";
        }
    }

    let releaseYear = "";
    if (item.release_date) {
        releaseYear = new Date(item.release_date).getFullYear();
    } else if (item.first_air_date) {
        releaseYear = new Date(item.first_air_date).getFullYear();
    }

    const yearRuntimeDiv = document.createElement('div');
    yearRuntimeDiv.classList.add('year-runtime');
    yearRuntimeDiv.innerHTML = `${releaseYear ? releaseYear : ""}<span>${runtimeText}</span>`; // Added span
    column1.appendChild(yearRuntimeDiv);

    const genreParagraph = document.createElement('p');
    genreParagraph.textContent = "Genres: ";
    const genreNames = await getGenreNames(item.genre_ids || item.genres?.map(g => g.id), isMovie); // Handle both genre_ids and full genre objects
    genreParagraph.textContent = genreNames.length ? genreNames[0] : "N/A";
    column1.appendChild(genreParagraph);

    const voteAverage = document.createElement('p');
    voteAverage.innerHTML = `Rating: ${item.vote_average ? item.vote_average.toFixed(1) + ' ⭐' : 'N/A'}`;
    column1.appendChild(voteAverage);
	
	if (isMainItem && !isFromFilmography) {
		
		const buttonContainer = document.createElement('div'); // Create container
        buttonContainer.classList.add('button-container');
        try {
			
			const videos = await getVideos(item.id, isMovie );

		
			 if (videos && videos.results && videos.results.length > 0) {
				const trailer = videos.results.find(video => video.type === "Trailer" && video.site === "YouTube"); // Find YouTube trailer
				
				 if (trailer) {
					const trailerLink = document.createElement('a');
					trailerLink.href = `https://www.youtube.com/watch?v=${trailer.key}`; // Correct YouTube link
					trailerLink.target = "_blank";
					trailerLink.textContent = "Trailer";
					trailerLink.classList.add('trailer-button'); // Add the class
					buttonContainer.appendChild(trailerLink);
				}
			 }
			
					
			if (item.imdb_id) { // Use item.imdb_id directly
                const imdbLink = document.createElement('a');
                imdbLink.href = `https://www.imdb.com/title/${item.imdb_id}`;
                imdbLink.target = "_blank";
                imdbLink.textContent = "IMDb";
                imdbLink.classList.add('trailer-button');
                buttonContainer.appendChild(imdbLink);
            }

			column1.appendChild(buttonContainer);
        } catch (error) {
            console.error("Error fetching videos:", error);
        }
	
	}
	

	const providersContainer = document.createElement('div');
	if (item.watch && item.watch.flatrate) {
        
        providersContainer.classList.add('providersContainer');

        item.watch.flatrate.forEach(provider => {
            if (provider && provider.logo_path && provider.provider_name) { // Double check for data existence
				const providerLink = document.createElement('a');
				providerLink.href = item.watch.link || "#"; // Use the watch link or a fallback
				providerLink.target = '_blank';
				providerLink.rel = 'noopener noreferrer';

                const providerImg = new Image();
                providerImg.alt = provider.provider_name;
                providerImg.classList.add('loading');

                providerImg.onload = () => {
                    providerImg.classList.remove('loading');
                    providerImg.classList.add('loaded');
                };
                providerImg.onerror = () => {
                    providerImg.src = 'default-provider-logo.png';
                    providerImg.alt = `Logo for ${provider.provider_name} could not be loaded`;
                    providerImg.classList.remove('loading');
                    providerImg.classList.add('loaded');
                };

                providerImg.dataset.src = `https://image.tmdb.org/t/p/w92${provider.logo_path}`;
                providerImg.src = provider.logo_path ? `${ORIGINAL_IMAGE_BASE_URL}${provider.logo_path}` : 'default-provider-logo.png';

                providerLink.appendChild(providerImg);
                providersContainer.appendChild(providerLink);
            }
        });
        
    }

    try {
        const credits = await getCredits(item.id, isMovie);
        if (credits && credits.crew && credits.crew.length > 0) {
            const director = credits.crew.find(person => person.job === 'Director');
            if (director) {
				const directorDetails = document.createElement('div');
				directorDetails.classList.add('directorDetails');
				
				const directedByText = document.createElement('span');
				directedByText.textContent = "DIRECTED BY: ";
				directorDetails.appendChild(directedByText);
				
                const directorLink = document.createElement('a');
                directorLink.href = '#';
                directorLink.textContent = director.name;
                directorLink.addEventListener('click', () => handlePersonClick(director.name, 'director', true));
				directorDetails.appendChild(directorLink);
				column2.appendChild(directorDetails);
           
                column2.appendChild(document.createElement('br'));
            }
        }

        if (credits && credits.cast && credits.cast.length > 0) {
            const castHeading = document.createElement('p');
            castHeading.textContent = "CAST:";
            column2.appendChild(castHeading);

            const topCast = credits.cast.slice(0, 5);
            topCast.forEach(actor => {
                const actorLink = document.createElement('a');
                actorLink.href = '#';
                actorLink.textContent = actor.name;				
                actorLink.addEventListener('click', () => handlePersonClick(actor.name, "actor"));
                column2.appendChild(actorLink);
               
            });
            if(column2.lastChild){
                column2.lastChild.remove();
            }
        }
    } catch (error) {
        console.error("Error fetching credits:", error);
    }

    detailsContainer.appendChild(column1);
    detailsContainer.appendChild(column2);
	detailsContainer.appendChild(providersContainer);
    fragment.appendChild(detailsContainer); // Append details to fragment
    movieElement.appendChild(fragment); // Append fragment to movieElement
    container.appendChild(movieElement);
}

async function getVideos(itemId, isMovie) {
	
    const mediaType = isMovie ? 'movie' : 'tv';
	
    const url = `${BASE_API_URL}/${mediaType}/${itemId}/videos?api_key=${API_KEY}&language=en-US`;
   

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404) {
                console.warn(`No videos found for ${mediaType} with ID ${itemId}. Returning empty results.`);
                return { results: [] }; // Correct: Return an object with empty results
            }
            throw new Error(`HTTP error ${response.status} fetching videos.`);
        }
        const data = await response.json();
        return data; // Correct: Return the entire data object
    } catch (error) {
        console.error("Error fetching videos:", error);
        return { results: [] }; // Correct: Return an object with empty results on error
    }
}



async function getCredits(itemId, isMovie) {
    const type = isMovie ? 'movie' : 'tv';
    const url = `${BASE_API_URL}/${type}/${itemId}/credits?api_key=${API_KEY}`;
    return await fetchData(url);
}

// Improved genre caching
let allGenresCache = JSON.parse(localStorage.getItem('all_genres')) || {};

async function getGenreNames(genreIds, isMovie) {
    if (!genreIds || genreIds.length === 0) return [];

    let missingGenreIds = genreIds.filter(id => !allGenresCache[id]);

    if (missingGenreIds.length > 0) {
        const type = isMovie ? 'movie' : 'tv';
        const url = `${BASE_API_URL}/genre/${type}/list?api_key=${API_KEY}&language=en-US`;

        try {
            const data = await fetchData(url);
            if (data && data.genres) {
                data.genres.forEach(genre => allGenresCache[genre.id] = { name: genre.name, type });
                localStorage.setItem('all_genres', JSON.stringify(allGenresCache));
            }
        } catch (error) {
            console.error("Error fetching genres:", error);
            return []; // Return empty array on error
        }
    }

    return genreIds.map(id => allGenresCache[id]?.name).filter(name => name);
}

async function handlePersonClick(personName, searchTypes) {

    movieInput.value = personName;
	
    const buttons = document.querySelectorAll('.search-type-button');

    buttons.forEach(btn => btn.classList.remove('active'));

    const targetButton = document.querySelector(`.search-type-button[data-type="${searchTypes}"]`);

    if (targetButton) {

        targetButton.classList.add('active');

        currentSearchType = searchTypes;		
    }
	searchType.value = searchTypes;
	currentSearchType = searchTypes;	
    searchContent();

}

async function displayTopRatedResults(videos, isMovie, currentPage = 1, totalPages = 20) {
    
  
    let row = resultsContainer.querySelector('.movie-row:last-child'); // Get the last row or null if none
    if (!row) {
        row = document.createElement('div');
        row.classList.add('movie-row');
        resultsContainer.appendChild(row);
    }

    const fragment = document.createDocumentFragment(); // Use a DocumentFragment

    for (const item of videos) {
        const movieElement = document.createElement('div');
        movieElement.classList.add('movie-row-item');
	
		const imageContainer = document.createElement('div');
		
		const imgLink = document.createElement('a');
		imgLink.href = '#';
		console.log(`handleItemOrPersonClick: ${isMovie ? 'movie' : 'tv'}`);
		imgLink.addEventListener('click', () => handleItemOrPersonClick(item.title || item.name, isMovie ? 'movie' : 'tv', isMovie));

		const img = new Image();
		img.onload = () => {
		  img.classList.remove('loading'); // Remove loading class when loaded
		  img.classList.add('loaded');
		};
		img.onerror = () => {
		  img.src = 'placeholder.jpg';
		  img.alt = "Image could not be loaded";
		  img.classList.remove('loading'); // Remove loading class even on error
		  img.classList.add('loaded'); // Add loaded class in case of error to prevent further attempts
		};
		img.src = item.poster_path ? `${IMAGE_BASE_URL}${item.poster_path}` : 'placeholder.jpg';

		img.alt = item.title || item.name;
		img.classList.add('loading'); // Add loading class initially

		imgLink.appendChild(img);
		imageContainer.appendChild(imgLink);

		const detailsDiv = document.createElement('div');
		detailsDiv.classList.add('movieDetails');

		const nameHeading = document.createElement('a');
		nameHeading.textContent = isMovie ? item.title : item.name;
		detailsDiv.appendChild(nameHeading);
		
		
		let releaseYear = "";
		if (item.release_date) {
			releaseYear = new Date(item.release_date).getFullYear();
		} else if (item.first_air_date) {
			releaseYear = new Date(item.first_air_date).getFullYear();
		}
		
		const yearHeading = document.createElement('a');
		yearHeading.classList.add('a');
		yearHeading.innerHTML = `(${releaseYear ? releaseYear : ""})  <span>${item.vote_average ? item.vote_average.toFixed(1) + ' ⭐' : 'N/A'}</span> `; // Added span
		detailsDiv.appendChild(yearHeading);
		
		
		const providersContainer = document.createElement('div');
		if (item.watch && item.watch.flatrate) {
			
			providersContainer.classList.add('movie-row-providersContainer');

			item.watch.flatrate.forEach(provider => {
				if (provider && provider.logo_path && provider.provider_name) { // Double check for data existence
					const providerLink = document.createElement('a');
					providerLink.href = item.watch.link || "#"; // Use the watch link or a fallback
					providerLink.target = '_blank';
					providerLink.rel = 'noopener noreferrer';

					const providerImg = new Image();
					providerImg.alt = provider.provider_name;
					providerImg.classList.add('loading');

					providerImg.onload = () => {
						providerImg.classList.remove('loading');
						providerImg.classList.add('loaded');
					};
					providerImg.onerror = () => {
						providerImg.src = 'default-provider-logo.png';
						providerImg.alt = `Logo for ${provider.provider_name} could not be loaded`;
						providerImg.classList.remove('loading');
						providerImg.classList.add('loaded');
					};

					providerImg.dataset.src = `https://image.tmdb.org/t/p/w92${provider.logo_path}`;
					providerImg.src = provider.logo_path ? `${ORIGINAL_IMAGE_BASE_URL}${provider.logo_path}` : 'default-provider-logo.png';

					providerLink.appendChild(providerImg);
					providersContainer.appendChild(providerLink);
				}
			});
			
		}

	
    imageContainer.appendChild(detailsDiv);
	imageContainer.appendChild(providersContainer);
	movieElement.appendChild(imageContainer); // Append fragment to movieElement
    row.appendChild(movieElement);
	
  }
 
  resultsContainer.appendChild(fragment);

    const hasNextPage = currentPage < totalPages;

    let loadMoreButton = resultsContainer.querySelector('.load-more-button');
    if (hasNextPage && !loadMoreButton) {
        loadMoreButton = document.createElement('button');
        loadMoreButton.textContent = 'Load More';
        loadMoreButton.classList.add('load-more-button');
        loadMoreButton.addEventListener('click', async () => {
            loadTopRatedMovies(isMovie, currentPage + 1);
            loadMoreButton.remove();
        });
        resultsContainer.appendChild(loadMoreButton);
    } else if (!hasNextPage && loadMoreButton) {
        loadMoreButton.remove();
    }
  
}


async function displayActorResults(actors) {
    resultsContainer.innerHTML = '';

    const fragment = document.createDocumentFragment(); // Use a DocumentFragment

    for (const actor of actors) {
        const actorDiv = document.createElement('div');
        actorDiv.classList.add('movieItem'); // Use the same class for consistent styling

        const img = new Image();
        img.onload = () => {
            img.classList.remove('loading');
            img.classList.add('loaded');
        };
        img.onerror = () => {
            img.src = 'placeholder.jpg';
            img.alt = "Image could not be loaded";
            img.classList.remove('loading');
            img.classList.add('loaded');
        };
        img.src = actor.profile_path ? `${IMAGE_BASE_URL}${actor.profile_path}` : 'placeholder.jpg';
        img.alt = actor.name;
        img.classList.add('loading');

        actorDiv.appendChild(img);

        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('movieDetails');

        const nameHeading = document.createElement('h2');
        nameHeading.textContent = actor.name;
        detailsDiv.appendChild(nameHeading);

        const filmographyButton = document.createElement('button');
        filmographyButton.textContent = 'Filmography';
        filmographyButton.classList.add('filmography-button');
        filmographyButton.addEventListener('click', async () => {
            if (filmographyRequestTimer) {
                clearTimeout(filmographyRequestTimer);
            }

            filmographyRequestTimer = setTimeout(async () => {
                filmographyRequestTimer = null;
                await displayActorFilmography(actor.id, actor.name, false); // isDirector = false for actors
            }, FILMOGRAPHY_REQUEST_DELAY);
        });
		
        detailsDiv.appendChild(filmographyButton);

        actorDiv.appendChild(detailsDiv);
        fragment.appendChild(actorDiv); // Append to fragment
    }

    resultsContainer.appendChild(fragment); // Append fragment to container
   
}

async function displayActorFilmography(actorId, actorName, isDirector = false) {
    resultsContainer.innerHTML = '';
	showLoader(); // Show the loader *before* fetching data

    let allCredits = [];
	let DirectorCredits = [];
    let currentStartIndex = 0;
    let filmographyWithProviders = [];

    try {
        const credits = await getActorCredits(actorId);
        if (credits && credits.cast) {
            allCredits = [...credits.cast, ...credits.crew];
            //Make credits unique based on id
            const uniqueCredits = [];
            const seenIds = new Set();
            for (const credit of allCredits) {
                if (credit.id && !seenIds.has(credit.id)) {
                    uniqueCredits.push(credit);
                    seenIds.add(credit.id);
                }
            }
            allCredits = uniqueCredits;
			
            if (allCredits.length === 0) {
                const noResultsMessage = document.createElement("p");
                noResultsMessage.textContent = `No filmography found for ${actorName}`;
                resultsContainer.appendChild(noResultsMessage);
                return;
            }
			
			let filteredCredits;
			if (isDirector) {
				filteredCredits = allCredits.filter(credit => credit.job === "Director" && credit.media_type === "movie");
				if (filteredCredits.length === 0) {
					resultsContainer.innerHTML = `<p>No directed movies found for ${actorName}.</p>`;
					return;
				}
			} else {
				filteredCredits = allCredits.filter(credit => credit.media_type === "movie");
				if (filteredCredits.length === 0) {
					resultsContainer.innerHTML = `<p>No acted in movies found for ${actorName}.</p>`;
					return;
				}
			}
			
			const uniqueCredits2 = Array.from(new Set(filteredCredits.map(JSON.stringify))).map(JSON.parse);
	
            filmographyWithProviders = await Promise.all(uniqueCredits2.map(async (item) => {
                try {
                    const isMovie = item.media_type === 'movie';
                    const providers = await getWatchProviders(item.id, item.media_type);
                    item.watch = getWatchData(providers);
                    return item;
                } catch (error) {
                    console.error("Error fetching providers for filmography item:", error);
                    return { ...item, watch: null };
                }
            }));

			filmographyWithProviders.sort((a, b) => {
				let dateA = a.release_date || a.first_air_date;
				let dateB = b.release_date || b.first_air_date;

				if (!dateA && !dateB) return 0;
				if (!dateA) return 1;
				if (!dateB) return -1;

				// Extract year for consistent comparison
				const yearA = dateA.substring(0, 4); // Extract the year
				const yearB = dateB.substring(0, 4); // Extract the year

				if (isNaN(yearA) || isNaN(yearB)) return 0; // Handle cases where year extraction fails

				return parseInt(yearB) - parseInt(yearA); // Compare years as numbers for descending order
			});

            displayNextCredits();

            const loadMoreButton = document.createElement('button');
            loadMoreButton.textContent = 'Load More';
            loadMoreButton.classList.add('filmography-button', 'load-more-button'); // Combined classes
            loadMoreButton.addEventListener('click',  () => {
				currentTopRatedPage++;
				displayNextCredits();
			});
            resultsContainer.appendChild(loadMoreButton);

        } else {
            alert("Could not retrieve filmography.");
        }
    } catch (error) {
        console.error("Error fetching actor credits:", error);
        alert("An error occurred fetching filmography.");
     } finally {
        hideLoader();//Hide the loader even if there is an error
    }
	

    function displayNextCredits() {
        const nextCredits = filmographyWithProviders.slice(currentStartIndex, currentStartIndex + CREDITS_PER_PAGE);
        if (nextCredits.length === 0) {
            const loadMoreButton = document.querySelector(".load-more-button");
            if (loadMoreButton) loadMoreButton.remove();
            return;
        }

        const tempContainer = document.createElement('div');
        nextCredits.forEach(credit => {
            displayItem(credit, credit.media_type === 'movie', tempContainer, false, true);
        });
        resultsContainer.insertBefore(tempContainer, document.querySelector(".load-more-button"));
        currentStartIndex += CREDITS_PER_PAGE;

        if (currentStartIndex >= filmographyWithProviders.length) {
            const loadMoreButton = document.querySelector(".load-more-button");
            if (loadMoreButton) loadMoreButton.remove();
        }
    }
}

async function getActorCredits(actorId) {
    const cacheKey = `${BASE_API_URL}/person/${actorId}/combined_credits?api_key=${API_KEY}`;
    
    if (apiCache.credits[cacheKey]) {
        return apiCache.credits[cacheKey];  // Return cached credits if available
    }

    try {
        const response = await fetchData(cacheKey);
        apiCache.credits[cacheKey] = response;  // Cache the fetched credits
        return response;
    } catch (error) {
        console.error("Error fetching actor credits:", error);
        return null;
    }
}

// Consistent async/await in getMovieSuggestions
async function getMovieSuggestions(query) {
    const url = `${BASE_API_URL}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText} for URL: ${url}`);
        }
        const data = await response.json();
        return data.results;
    } catch (error) {
        console.error("Error fetching suggestions:", error);
        return [];
    }
}

function showLoader() {
    loader.style.display = 'block';
}

function hideLoader() {
    loader.style.display = 'none';
}

function lazyLoadImages() {
    const images = document.querySelectorAll('.movieItem img.loading, .providersContainer img.loading');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('loading');
                observer.unobserve(img);
            }
        });
    });

    images.forEach(image => {
        observer.observe(image);
    });
}



// Event Listeners
let timeoutId; // Declare timeoutId in the outer scope

movieInput.addEventListener('input', () => {
    clearTimeout(timeoutId); // Clear previous timeout (even if it's undefined initially, clearTimeout handles it)

    timeoutId = setTimeout(async () => {
        const query = movieInput.value.trim();
        if (query.length < 3) {
            suggestionsList.innerHTML = '';
            return;
        }
        const suggestions = await getMovieSuggestions(query);
        suggestionsList.innerHTML = '';
        if (suggestions && suggestions.length > 0) {
			suggestions.forEach(suggestion => {
			let title = suggestion.title || suggestion.name;
			if (!title) return;

			let typeHint = '';
			let year = '';

			switch (suggestion.media_type) {
				case 'movie':
					typeHint = '(Movie)';
					currentSearchType = 'movie';				    
					year = suggestion.release_date ? ` (${suggestion.release_date.substring(0, 4)})` : '';
					break;
				case 'tv':
					typeHint = '(TV Show)';
					currentSearchType = 'tv';
					year = suggestion.first_air_date ? ` (${suggestion.first_air_date.substring(0, 4)})` : '';
					break;
				case 'person':
					typeHint = `(${suggestion.known_for_department || 'Person'})`;
					currentSearchType ='actor';
					break;
				default:
					typeHint = '(Unknown)';
			}
			searchType.value = currentSearchType;
			const li = document.createElement('li');
			li.innerHTML = `${title} <span class="suggestion-type">${typeHint}${year}</span>`;
			li.addEventListener('click', () => {
				movieInput.value = title;
				suggestionsList.innerHTML = '';
				searchContent();
			});
			suggestionsList.appendChild(li);
			});
        } else {
            const li = document.createElement('li');
            li.textContent = "No result found";
            suggestionsList.appendChild(li);
        }
    }, 300);
});

searchForm.addEventListener('submit', () => {
    suggestionsList.innerHTML = '';
});

document.getElementById('header-link').addEventListener('click', () => {
    location.reload();
});

document.addEventListener('click', (event) => {
    if (!movieInput.contains(event.target) && !suggestionsList.contains(event.target)) {
        suggestionsList.innerHTML = '';
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    await fetchAndDisplayPopularMovies();
    setupTypeButtons();
});



//Helper function to delay execution
const delay = ms => new Promise(res => setTimeout(res, ms)); // Delay function