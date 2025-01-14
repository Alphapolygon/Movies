
let currentSearchType = 'movie'; // Default search type
let userRegion = 'US'; // Default region fallback


const movieInput = document.getElementById('movieInput');
const suggestionsList = document.getElementById('suggestions');
const searchForm = document.getElementById('searchForm'); // Get the form element
let timeoutId;

movieInput.addEventListener('input', () => {
    clearTimeout(timeoutId); // Clear previous timeout

    timeoutId = setTimeout(async () => { // Debounce input
        const query = movieInput.value.trim();

        if (query.length < 3) { // Only search if query is at least 3 characters
            suggestionsList.innerHTML = ''; // Clear suggestions
            return;
        }

        try {
            const suggestions = await getMovieSuggestions(query); // Fetch suggestions

            suggestionsList.innerHTML = ''; // Clear previous suggestions

            if (suggestions && suggestions.length > 0) {
                suggestions.forEach(suggestion => {
                    const li = document.createElement('li');
                    li.textContent = suggestion.title || suggestion.name;
                    li.addEventListener('click', () => {
                        movieInput.value = suggestion.title || suggestion.name;
                        suggestionsList.innerHTML = ''; // Clear suggestions after selection
                    });
                    suggestionsList.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                    li.textContent = "No result found";
                    suggestionsList.appendChild(li);
            }
        } catch (error) {
            console.error('Error fetching suggestions:', error);
        }
    }, 300); // Wait 300ms after user stops typing
});

// Add event listener to the form's submit event
searchForm.addEventListener('submit', () => {
    suggestionsList.innerHTML = ''; // Clear suggestions when search is submitted
});

// Add event listener to the document to close the suggestions if clicked outside the input and suggestions
document.addEventListener('click', (event) => {
    if (!movieInput.contains(event.target) && !suggestionsList.contains(event.target)) {
        suggestionsList.innerHTML = '';
    }
});

async function getMovieSuggestions(query) {
    const url = `https://api.themoviedb.org/3/search/multi?api_key=3bbf380371a2169bd25b710058646650&query=${encodeURIComponent(query)}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.results;
    } catch (error) {
        console.error("error fetching suggestions", error)
    }
}



document.addEventListener("DOMContentLoaded", async () => {
    await fetchAndDisplayPopularMovies();
});

async function detectUserRegion() {
    // Check if the region is already cached
    const cachedRegion = localStorage.getItem('userRegions');
    if (cachedRegion) {
        userRegion = cachedRegion;
        console.log(`Using cached region: ${userRegion}`);
        return userRegion;
    }

    try {
        // Fetch the user's region if not cached
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) {
            throw new Error('Failed to fetch region');
        }
        const data = await response.json();
        userRegion = data.country_code; // Set userRegion to the detected country code
        console.log(`Detected region: ${userRegion}`);

        // Cache the detected region
        localStorage.setItem('userRegions', userRegion);
        return userRegion;
    } catch (error) {
        console.error('Error detecting user region:', error);
        userRegion = 'US'; // Fallback to default region
        return userRegion;
    }
}

// Replace updateSearchType function
function setupTypeButtons() {
    const buttons = document.querySelectorAll('.search-type-button');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            buttons.forEach(btn => btn.classList.remove('active')); // Remove active class from all buttons
            button.classList.add('active'); // Add active class to the clicked button
            currentSearchType = button.dataset.type; // Update currentSearchType
        });
    });
}
document.addEventListener("DOMContentLoaded", async () => {
    await fetchAndDisplayPopularMovies();
    setupTypeButtons(); // Call the function to set up the buttons
});

async function searchContent() {
	await detectUserRegion();
	
    const movieName = document.getElementById('movieInput').value.trim();
    
    if (!movieName) {
        alert("Please enter a movie or TV show name.");
        return;
    }

    try {
        let id; // Variable to hold the ID (movieId or tvShowId)
         showLoader(); // Show loader while searching
        if (currentSearchType === 'movie') {
            id = await getMovieId(movieName);
            const similarItems = await getSimilarMovies(id);
			const providerPromises = similarItems.map(async (movie) => {
				const providers = await getWatchProviders(movie.id);

				// Extract US-specific data or adjust for another region
				const regionData = providers && providers[userRegion];
				const watchLink = regionData ? regionData.link : null;
				const flatrateProviders = regionData ? regionData.flatrate : null;

				return { ...movie, watch: { link: watchLink, flatrate: flatrateProviders } };
			});

			const moviesWithProviders = await Promise.all(providerPromises);
			moviesWithProviders.sort((a, b) => b.vote_average - a.vote_average);			
            displayResults(moviesWithProviders, true);  // Display as movies
			
        } else if (currentSearchType === 'tv') {
            id = await getTvShowId(movieName);
            const similarItems = await getSimilarShows(id);
			const providerPromises = similarItems.map(async (movie) => {
				const providers = await getTVWatchProviders(movie.id);

				// Extract US-specific data or adjust for another region
				const regionData = providers && providers['FI'];
				const watchLink = regionData ? regionData.link : null;
				const flatrateProviders = regionData ? regionData.flatrate : null;

				return { ...movie, watch: { link: watchLink, flatrate: flatrateProviders } };
			});

			const moviesWithProviders = await Promise.all(providerPromises);
			moviesWithProviders.sort((a, b) => b.vote_average - a.vote_average);
            displayResults(moviesWithProviders, false); // Display as TV shows
        }else if (currentSearchType === 'actor') { // New: Actor search
            id = await searchActors(movieName);
            if (id && id.length > 0) {
              displayActorResults(id);
            } else {
              alert("No actors found.");
            }
        }

        if (!id) {
            alert("Item not found. Please check the spelling and try again.");
        }
    } catch (error) {
        console.error('Error:', error);
        alert("An error occurred. Please try again.");
     } finally {
        hideLoader(); // Hide loader after search completes
    }
}

// Show the loader
function showLoader() {
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
}

// Hide the loader
function hideLoader() {
    const loader = document.getElementById('loader');
    loader.style.display = 'none';
}

async function searchActors(actorName) {
    const url = `https://api.themoviedb.org/3/search/person?api_key=3bbf380371a2169bd25b710058646650&query=${encodeURIComponent(actorName)}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data.results;
    } catch (error) {
        console.error("Error searching actors:", error);
        return null;
    }
}


async function fetchAndDisplayPopularMovies() {
	
	
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=3bbf380371a2169bd25b710058646650&language=en-US&sort_by=popularity.desc&page=1`;

	try {
        const response = await fetch(url);
        const data = await response.json();

        // Add isPopular property to the movies
        const popularMovies = data.results.map(movie => ({ ...movie, isPopular: true }));

        const popularMoviesWithProviders = await getMoviesWithProviders(popularMovies, true);

        displayPopular(popularMoviesWithProviders);
    } catch (error) {
        console.error("Error fetching popular movies:", error);
    } finally {
        hideLoader();
    }
}

async function getTVWatchProviders(movieId) {

	
	try {
        const response = await fetch(`https://api.themoviedb.org/3/tv/${movieId}/watch/providers?api_key=3bbf380371a2169bd25b710058646650`);
        const data = await response.json();
        return data.results; // Return region-specific results
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null on failure
    }
}


async function getWatchProviders(movieId) {

	try {
        const response = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=3bbf380371a2169bd25b710058646650`);
        const data = await response.json();
        return data.results; // Return region-specific results
    } catch (error) {
        console.error('Error fetching watch providers:', error);
        return null; // Return null on failure
    }
}


async function getTvShowId(movieName) {
 
	const url = `https://api.themoviedb.org/3/search/tv?api_key=3bbf380371a2169bd25b710058646650&query=${encodeURIComponent(movieName)}`;

	try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if the search returned any results
        if (data.results.length > 0) {
            const movieId = data.results[0].id;
            //alert(`Movie ID for "${movieName}": ${movieId}`);
            return movieId; // In case you want to use it later
        } else {
            alert("No movies found with that name.");
            return null;
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}

async function getSimilarShows(movieId) {
   
  const url = `https://api.themoviedb.org/3/tv/${movieId}/recommendations?api_key=3bbf380371a2169bd25b710058646650&language=en-US&page=1`;

  try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        return data.results; // This contains the list of similar movies
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}




async function getMovieId(movieName) {

    const url = `https://api.themoviedb.org/3/search/movie?api_key=3bbf380371a2169bd25b710058646650&query=${encodeURIComponent(movieName)}`;

	try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Check if the search returned any results
        if (data.results.length > 0) {
            const movieId = data.results[0].id;
            //alert(`Movie ID for "${movieName}": ${movieId}`);
            return movieId; // In case you want to use it later
        } else {
            alert("No movies found with that name.");
            return null;
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}

async function getSimilarMovies(movieId) {
   

	const url = `https://api.themoviedb.org/3/movie/${movieId}/recommendations?api_key=3bbf380371a2169bd25b710058646650&language=en-US&page=1`;
    

  try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        return data.results; // This contains the list of similar movies
    } catch (error) {
        console.error('Error fetching data:', error);
        alert(`An error occurred: ${error.message}`);
    }
}

// Modify getMovieData and getTVShowData to include genre information
async function getMovieData(movieId) {
    const url = `https://api.themoviedb.org/3/movie/${movieId}?api_key=3bbf380371a2169bd25b710058646650`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data; // Now includes genres
    } catch (error) {
        console.error("Error fetching movie data:", error);
        return null;
    }
}

async function getTVShowData(tvShowId) {
    const url = `https://api.themoviedb.org/3/tv/${tvShowId}?api_key=3bbf380371a2169bd25b710058646650`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data; // Now includes genres
    } catch (error) {
        console.error("Error fetching tv show data:", error);
        return null;
    }
}

async function getMoviesWithProviders(similarItems, isMovie = true) {
    const providerPromises = similarItems.map(async (item) => {
        const providers = isMovie ? await getWatchProviders(item.id) : await getTVWatchProviders(item.id);

        const regionData = providers && providers[userRegion];
        const watchLink = regionData ? regionData.link : null;
        const flatrateProviders = regionData ? regionData.flatrate : null;

        return { ...item, watch: { link: watchLink, flatrate: flatrateProviders } };
    });

    return await Promise.all(providerPromises);
}

async function displayActorResults(actors) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';

    for (const actor of actors) {
        const actorDiv = document.createElement('div');
        actorDiv.classList.add('movieItem');

        const img = document.createElement('img');
        img.src = actor.profile_path ? `https://image.tmdb.org/t/p/w200${actor.profile_path}` : 'placeholder.jpg';
        img.alt = actor.name;
        actorDiv.appendChild(img);

        const detailsDiv = document.createElement('div');
        detailsDiv.classList.add('movieDetails');

        const nameHeading = document.createElement('h2');
        nameHeading.textContent = actor.name;
        detailsDiv.appendChild(nameHeading);

        if (actor.known_for && actor.known_for.length > 0) {
            const knownForContainer = document.createElement('div'); // Container for known_for items
            knownForContainer.classList.add('providersContainer'); // Use the same styling

            for (const movie of actor.known_for) {
                if (movie.media_type === "movie" || movie.media_type === "tv") { // only shows movies and tv shows
                    const movieLink = document.createElement('a');
                    movieLink.href = "#";
					movieLink.addEventListener("click", async () => {
                        document.getElementById("movieInput").value = movie.title || movie.name;

                        // Update active button and currentSearchType (same as in displayItem)
                        const buttons = document.querySelectorAll('.search-type-button');
                        buttons.forEach(btn => btn.classList.remove('active'));
                        const targetButton = document.querySelector(`.search-type-button[data-type="${movie.media_type}"]`);
                        if (targetButton) {
                            targetButton.classList.add('active');
                            currentSearchType = movie.media_type;
                        }

                        await searchContent();
                    });
                    const movieImg = document.createElement('img');
                    movieImg.src = movie.poster_path
                        ? `https://image.tmdb.org/t/p/w92${movie.poster_path}`
                        : 'default-provider-logo.png';
                    movieImg.alt = movie.title || movie.name;
                    movieImg.style.width = '100px';
                    movieLink.appendChild(movieImg);
                    knownForContainer.appendChild(movieLink);
                }
            }
            detailsDiv.appendChild(knownForContainer);
        }

        actorDiv.appendChild(detailsDiv);
        container.appendChild(actorDiv);
    }
}



function displayPopular(movies) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = ''; // Clear previous results

    movies.forEach(movie => {
        displayItem(movie, true, container, true); // Pass true to skipProviderCheck
    });
}

async function displayResults(similarItems, isMovie) {
    const container = document.getElementById('resultsContainer');
    container.innerHTML = '';

    const searchTerm = document.getElementById('movieInput').value.trim();

    try {
        let id;
        if (isMovie) {
            id = await getMovieId(searchTerm);
        } else {
            id = await getTvShowId(searchTerm);
        }

        if (id) {
            let searchedItem;
            if (isMovie) {
                searchedItem = await getMovieData(id);
            } else {
                searchedItem = await getTVShowData(id);
            }

            if (searchedItem) {
                const providers = isMovie ? await getWatchProviders(id) : await getTVWatchProviders(id);
                const regionData = providers && providers[userRegion];
                const watchLink = regionData ? regionData.link : null;
                const flatrateProviders = regionData ? regionData.flatrate : null;
                searchedItem.watch = { link: watchLink, flatrate: flatrateProviders };

                displayItem(searchedItem, isMovie, container, true); // Display the main item FIRST
				


                // Fetch providers for similar items and DISPLAY ALL
                const similarItemsWithProviders = await Promise.all(similarItems.map(async (item) => {
                    try {
                        const providers = isMovie ? await getWatchProviders(item.id) : await getTVWatchProviders(item.id);
                        const regionData = providers && providers[userRegion];
                        const watchLink = regionData ? regionData.link : null;
                        const flatrateProviders = regionData ? regionData.flatrate : null;
                        return { ...item, watch: { link: watchLink, flatrate: flatrateProviders } };
                    } catch (error) {
                        console.error("Error fetching providers for similar item:", error);
                        return { ...item, watch: null };
                    }
                }));
                const separatorRow = document.createElement('div');
                separatorRow.classList.add('separator-row');
                separatorRow.textContent = `People who watched ${searchedItem.title || searchedItem.name} also watched:`;
                container.appendChild(separatorRow);
                similarItemsWithProviders.forEach(item => {
                    displayItem(item, isMovie, container, false); // Similar items
                });
            } else {
                alert("Item not found. Please check the spelling and try again.");
            }
        }
    } catch (error) {
        console.error("Error displaying results:", error);
        alert("An error occurred. Please try again.");
    }
}

async function displayItem(movie, isMovie, container, isMainItem) {
    if (!isMainItem && (!movie.watch || !movie.watch.flatrate)) {
        return; // Don't display if no providers for similar items
    }
    const movieElement = document.createElement('div');
    movieElement.classList.add('movieItem');

    // Image Section (Left)
    const imageContainer = document.createElement('div');
    imageContainer.classList.add('image-container');
    const imgLink = document.createElement('a');
    imgLink.href = '#';
    imgLink.addEventListener('click', async () => {
        document.getElementById('movieInput').value = movie.title || movie.name;
        const buttons = document.querySelectorAll('.search-type-button');
        buttons.forEach(btn => btn.classList.remove('active'));
        const targetButton = document.querySelector(`.search-type-button[data-type="${isMovie ? 'movie' : 'tv'}"]`);
        if (targetButton) {
            targetButton.classList.add('active');
            currentSearchType = isMovie ? 'movie' : 'tv';
        }
        await searchContent();
    });
    const img = new Image();
    img.src = `https://image.tmdb.org/t/p/w200${movie.poster_path}`;
    img.alt = isMovie ? movie.title : movie.name;
    img.style.cursor = 'pointer';
    imgLink.appendChild(img);
    imageContainer.appendChild(imgLink);
    movieElement.appendChild(imageContainer);


    const detailsContainer = document.createElement('div');
    detailsContainer.classList.add('movieDetails');
    detailsContainer.style.display = 'grid';
    detailsContainer.style.gridTemplateColumns = '1fr 1fr';
    detailsContainer.style.gap = '5px';

    const column1 = document.createElement('div');
    const column2 = document.createElement('div');

    const title = document.createElement('h2');
    title.textContent = isMovie ? movie.title : movie.name;
    column1.appendChild(title);

    const releaseDate = document.createElement('p');
    releaseDate.textContent = `Release Date: ${isMovie ? movie.release_date : movie.first_air_date}`;
    column1.appendChild(releaseDate);

    // *** NEW: Genre Display ***
    const genreParagraph = document.createElement('p');
    genreParagraph.textContent = "Genres: ";
    if (movie.genre_ids) { //Check if genre_ids exists
      const genreNames = await getGenreNames(movie.genre_ids, isMovie);
      genreParagraph.textContent += genreNames.join(", "); //join the genres by comma
    } else if (movie.genres) { //If full genre data is available from getMovieData/getTVShowData
        const genreNames = movie.genres.map(genre => genre.name);
        genreParagraph.textContent += genreNames.join(", ");
    } else {
      genreParagraph.textContent += "N/A";
    }
    column1.appendChild(genreParagraph);

    const voteAverage = document.createElement('p');
    voteAverage.innerHTML = `Rating: ${movie.vote_average.toFixed(1)} ⭐`;
    column1.appendChild(voteAverage);

    // Providers Section moved to column 1
    const providersContainer = document.createElement('div');
    providersContainer.classList.add('providersContainer');
    if (movie.watch && movie.watch.flatrate) {
        movie.watch.flatrate.forEach(provider => {
            const providerLink = document.createElement('a');
            const providerImg = new Image();
            providerImg.src = provider.logo_path
                ? `https://image.tmdb.org/t/p/original${provider.logo_path}`
                : 'default-provider-logo.png';
            providerImg.alt = provider.provider_name;
            providerImg.style.width = '50px';

            providerLink.appendChild(providerImg);
            providersContainer.appendChild(providerLink);
        });
    }
    column1.appendChild(providersContainer);


    // Fetch and display director and cast (Now in column 2)
    try {
        const credits = await getCredits(movie.id, isMovie);
        if (credits) {
            if (credits.crew) {
                const director = credits.crew.find(person => person.job === 'Director');
                if (director) {
                    const directorLink = document.createElement('a');
                    directorLink.href = '#';
                    directorLink.textContent = `Director: ${director.name}`;
                    directorLink.addEventListener('click', () => {
                        document.getElementById('movieInput').value = director.name;
                        const buttons = document.querySelectorAll('.search-type-button');
                        buttons.forEach(btn => btn.classList.remove('active'));
                        const targetButton = document.querySelector(`.search-type-button[data-type="actor"]`);
                        if (targetButton) {
                            targetButton.classList.add('active');
                            currentSearchType = "actor";
                        }
                        searchContent();
                    });
                    column2.appendChild(directorLink);
                    column2.appendChild(document.createElement('br'));
                }
            }

            if (credits.cast && credits.cast.length > 0) {
                const castHeading = document.createElement('p');
                castHeading.textContent = "Cast:";
                column2.appendChild(castHeading);

                const topCast = credits.cast.slice(0, 5);

                topCast.forEach(actor => {
                    const actorLink = document.createElement('a');
                    actorLink.href = '#';
                    actorLink.textContent = actor.name;
                    actorLink.addEventListener('click', () => {
                        document.getElementById('movieInput').value = actor.name;
                        const buttons = document.querySelectorAll('.search-type-button');
                        buttons.forEach(btn => btn.classList.remove('active'));
                        const targetButton = document.querySelector(`.search-type-button[data-type="actor"]`);
                        if (targetButton) {
                            targetButton.classList.add('active');
                            currentSearchType = "actor";
                        }
                        searchContent();
                    });
                    column2.appendChild(actorLink);
                    column2.appendChild(document.createTextNode(""));
                });
                if(column2.lastChild){
                    column2.lastChild.remove();
                }
            }
        }
    } catch (error) {
        console.error("Error fetching credits:", error);
    }
    detailsContainer.appendChild(column1);
    detailsContainer.appendChild(column2);

    movieElement.appendChild(detailsContainer);
    container.appendChild(movieElement);
}

async function getCredits(movieId, isMovie) {
    const url = `https://api.themoviedb.org/3/${isMovie ? 'movie' : 'tv'}/${movieId}/credits?api_key=3bbf380371a2169bd25b710058646650`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Error fetching credits:", error);
        return null;
    }
}

// *** NEW: Function to fetch genre names ***
async function getGenreNames(genreIds, isMovie) {
    const genreList = isMovie ? 'movie' : 'tv';
    const cachedGenres = localStorage.getItem(`genres-${genreList}`);
    if (cachedGenres) {
        const genres = JSON.parse(cachedGenres);
        return genreIds.map(id => {
            const genre = genres.find(g => g.id === id);
            return genre ? genre.name : null;
        }).filter(name => name !== null); // Filter out nulls
    }

    try {
        const response = await fetch(`https://api.themoviedb.org/3/genre/${genreList}/list?api_key=3bbf380371a2169bd25b710058646650`);
        const data = await response.json();
        if (data && data.genres) {
            localStorage.setItem(`genres-${genreList}`, JSON.stringify(data.genres));
            return genreIds.map(id => {
                const genre = data.genres.find(g => g.id === id);
                return genre ? genre.name : null;
            }).filter(name => name !== null);
        }
        return [];
    } catch (error) {
        console.error("Error fetching genre list:", error);
        return [];
    }
}
